export interface IUpdates {
  height: number;
  contracts: Map<string, {
    id: string,
    txid: string,
    height: number
  }>;
}

export interface IUpdatesFile {
  height: number,
  contracts: {
    name: string,
    value: {
      id: string,
      txid: string,
      height: number
    }
  }[]
}