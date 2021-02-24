# speedweave
speedweave is a cli tool that works on Linux, Windows and Mac, it can be used as a stand-alone app using the executables available in [Releases](https://github.com/cedriking/speedweave/releases), or use it with Node from the [npm package](https://www.npmjs.com/package/speedweave).

speedweave was created to cache SmartWeave contract states, storing them into the permaweb to easily access the cached version with a GraphQL request.

The depoyed state has the following setup:
```
data: The updated state
tags:
  App-Name: speedweave
  Contract-Id: contractTxId
  Content-Type: application/json
```

Then with GraphQL you can easily grab the latest state of a trusted deployer, example:
```graphql
# Owners is an array of trusted deployers
# Sources is an array of contract-ids you want to get the lastest cached version, you can remove this tag to get any contract deployed by "owners".
query($owners: [String!], $sources: [String!]!) {
  transactions(
    owners: $owners
    tags: [
      { name: "App-Name", values: "speedweave"},
      { name: "Contract-Id", values: $sources },
      { name: "Content-Type", values: "application/json"}
    ]
  ) {
    pageInfo{
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
}
```

A few options are available to help easily deploy the cached states. You need to provide a wallet jwk key file and a list of trusted sources, these are the SmartWeave contract sources and from there it will search all contracts that use the same source to create a cache of them.

You can also set after how many blocks to deploy a new and updated version.

Options:
```
------ CacheWeave ------
-h/--help    = Show this help message. A list of options.
-w/--wallet  = Set the wallet path. Default is wallet.json
-b/--blocks  = Set how many blocks to save the cache transaction.
-t/--trusted = Set the trusted list of contract sources, one per line. Default is trusted.txt
```