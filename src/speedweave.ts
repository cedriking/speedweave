import fs from 'fs';
import os from 'os';
import minifist from 'minimist';
import chalk from 'chalk';
import promisePool from '@supercharge/promise-pool';
import Arweave from 'arweave';
import ora from 'ora';
import { all } from 'ar-gql';
import { readContract } from 'smartweave';
import { IUpdates, IUpdatesFile } from 'update.interface';

const argv = minifist(process.argv.slice(2));

if(argv.help || argv.h) {
  console.log(chalk.yellow('------ CacheWeave ------'));
  console.log('-h/--help    = Show this help message. A list of options.');
  console.log('-w/--wallet  = Set the wallet path. Default is wallet.json');
  console.log('-b/--blocks  = Set how many blocks to save the cache transaction.')
  console.log('-t/--trusted = Set the trusted list of contract sources, one per line. Default is trusted.txt');
  
  process.exit(0);
}

const numCpus = os.cpus().length;
const arweave = Arweave.init({
  host: 'arweave.net',
  protocol: 'https',
  port: 443
});

const walletArgv = argv.wallet || argv.w || 'wallet.json';
let wallet;
try {
  wallet = JSON.parse(fs.readFileSync(walletArgv, 'utf8'));
} catch (e) {
  error('--wallet is missing. It needs to be the wallet path. Default is wallet.json');
}

const trustedListArgv = argv.trusted || argv.t || 'trusted.txt';
let trustedList: string[] = [];
try {
  trustedList = fs.readFileSync(trustedListArgv, 'utf8').split('\n').map(i => i.trim());
} catch(e) {
  error('--trusted is missing. You need to create a list of trusted contract sources (one per line) and set the path as --trusted. Default is trusted.txt');
}

const updateBlocks = argv.blocks || argv.b || 10;

let updates: IUpdates = {
  height: 0,
  contracts: new Map()
};
if(fs.existsSync('updates.json')) {
  const updatesFile: IUpdatesFile = JSON.parse(fs.readFileSync('updates.json', 'utf8'));
  updates.height = updatesFile.height;
  for(const c of updatesFile.contracts) {
    updates.contracts.set(c.name, c.value);
  }
}

async function start() {
  console.log(`[${new Date().toLocaleString()}] ` + chalk.blue('Running cacheweave updater...'));

  // Check current height
  const height = +(await arweave.api.get('/info')).data.height;
  if(height < (updates.height+updateBlocks)) {
    console.log(chalk.yellow(`Not yet at the right height. Current ${height}, needed ${updates.height+updateBlocks}`));
    return restart();
  }

  // Get all the contracts and their last update (height)
  let spinner = ora('Getting the last state of the contracts').start();
  const contracts = (await getAllFromSources(height)).filter(contract => {
    const c = updates.contracts.get(contract.id);
    if(!c || !c.height) return true;
    return (contract.height >= (c.height+updateBlocks));
  });

  if(!contracts.length) {
    await saveChanges(height);
    console.log(chalk.yellow('No contracts to save. Skipping.'));
    return restart();
  }

  // We have new states to save
  const stateResults = await promisePool.withConcurrency(numCpus).for(contracts).process(async contract => {
    const state = await readContract(arweave, contract.id);
    return {id: contract.id, height: contract.height, state};
  });
  spinner.stop();
  spinner = null;

  // Send the new cache txs
  spinner = ora(`Submitting ${stateResults.results.length} new states`);
  const {results, errors} = await promisePool.withConcurrency(numCpus).for(stateResults.results).process(async contract => {
    const tx = await arweave.createTransaction({ data: JSON.stringify(contract.state) }, wallet);
    tx.addTag('App-Name', 'speedweave');
    tx.addTag('Contract-Id', contract.id);
    tx.addTag('Content-Type', 'application/json');


    await arweave.transactions.sign(tx, wallet);
    const r = await arweave.transactions.post(tx);

    if(r.status >= 400) {
      throw new Error(`Unable to post ${contract.id}`);
    }

    return {
      contractId: contract.id,
      contractHeight: contract.height,
      txId: tx.id
    };
  });
  spinner.stop();
  spinner = null;

  if(errors.length) {
    for(const err of errors) {
      error(err.stack, false);
    }
  }

  // Update the contracts
  spinner = ora(`Saving ${results.length} updated contracts.`);
  if(results.length) {
    for(const r of results) {
      console.log(chalk.blue(`Transaction ${r.txId} sent!`));
      updates.contracts.set(r.contractId, {
        id: r.contractId,
        height: r.contractHeight,
        txid: r.txId
      });
    }
  }

  // Done, save the changes
  await saveChanges(height);
  
  spinner.stop();
  spinner = null;

  restart();
}

async function saveChanges(height: number) {
  const updatesFile: IUpdatesFile = {
    height: height,
    contracts: Array.from(updates.contracts, ([name, value]) => ({name, value}))
  }
  fs.writeFile('updates.json', JSON.stringify(updatesFile), 'utf8', e => {
    if(e) console.log(e);
  });
}

async function getAllFromSources(height: number): Promise<{id: string, height: number}[]> {
  const res = await all(`
  query($cursor: String, $sources: [String!]!) {
    transactions(
      tags: [
        { name: "Contract-Src", values: $sources },
        { name: "App-Name", values: "SmartWeaveContract"},
        { name: "Content-Type", values: "application/json"}
      ]
      after: $cursor
      first: 100
    ) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          block {
            height
          }
        }
      }
    }
  }`, {
    sources: trustedList
  });
  
  return res.map(r => ({
    id: r.node.id,
    height: r.node.block?.height || height
  }));
}

function error(msg: string, exit: boolean = true) {
  console.error(chalk.red(msg));
  if(exit) process.exit(0);
}

function restart() {
  console.log(`[${new Date().toLocaleString()}] ` + chalk.green('Done! Checking again in 2 minutes...'));
  setTimeout(() => {
    start().catch(e => {
      console.log(e);
      restart();
    });
  }, 60000 * 2); // Every 2 minutes
}

(async () => {
  start().catch(e => {
    console.log(e);
    restart();
  });
})();