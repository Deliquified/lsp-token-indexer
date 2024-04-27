# LSP Token & NFT Indexer Powered by Envio's Hypersync

## Overview
LSP Token Indexer was built by **Deliquified Labs** to index all LSP7 tokens, LSP7 NFTs and LSP8 NFTs on the Lukso blockchain.
The indexer utilizes Envio's Hypersync solution to retrieve on-chain data blazing fast (100x improvement compared to the Graph).

Along with Envio, we use:

**Lukso API:** To fetch token contract metadata - name, symbol, supply, links etc. <br />

**Pinata:** Fetch off-chain metadata like NFT attributes, image etc. based on token ID <br />

**Prisma:** For storing the above in a database for later use

Resources: <br />

[Envio](https://envio.dev/) <br />

[Lukso API](https://docs.lukso.tech/tools/indexer) <br />

[Pinata](https://www.pinata.cloud/) <br />

[Prisma](https://www.prisma.io/)

## Disclaimer

This is a great resource for anyone new to Web3 development or blockchain in general. Whether you're a project building on Lukso and you need to display token metadata or you're learning about how to index blockchain events and extract on-chain/off-chain metadata - this indexer is for you. <br />

We'll be improving the performance over time, adding new features, optimizing existing code, adding support for LSP23, EOA contract deployment etc. Other than that, if you're looking to iterate on the indexer and adjust it to your needs, feel free to do so.

## Getting Started

### Prerequisites

Before you begin, ensure you have Node.js installed on your system. You can download it from [Node.js official website](https://nodejs.org/en).

### Cloning the Repository

To get started with the LSP Token & NFT Indexer, clone the repository to your local machine:

```
git clone https://github.com/Deliquified/lsp-token-indexer
cd hypersync-token-indexer
```
### Installation

After cloning the repository, install the necessary dependencies by running:

```
npm install
```

### Configuration

Create a .env file in the root directory of the project and populate it with the necessary environment variables:

```
NOWNODES_KEY=
LUKSO_API_KEY=
PINATA_PRIVATE_GATEWAY=
PINATA_GATEWAY_KEY=
DATABASE_API_ENDPOINT=
DATABASE_API_ENDPOINT_KEY=
```

You can get the API keys & gateway here:

[NowNodes](https://nownodes.io/)<br />

[Lukso API](https://docs.lukso.tech/tools/indexer)<br />

[Pinata](https://www.pinata.cloud/)

For the database - we use our own API solution to store the data in our database and cache the data in our API for further use. If you plan on using your own solution for storing the indexed data, you can leave it empty and adjust the following function:

```
// Send indexed token metadata to backend
async function sendMetadataToAPI(metadata, idCidPairs, type) {
  console.log(`📡 Sending metadata and ID-CID pairs to the backend API...`);

  const apiEndpoint = process.env.DATABASE_API_ENDPOINT;
  const apiKey = process.env.DATABASE_API_ENDPOINT_KEY;
  const payload = {
      metadata,
      idCidPairs,
      type
  };

  try {
    await axios.post(apiEndpoint, payload, {
      headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
      }
    });

    console.log('🎉 Metadata and ID-CID pairs sent to API successfully');
  } catch (error) {
      console.error('Failed to send metadata to API:', error);
  }
}
```
### Running the Indexer

To start the indexer, execute the following command:

```
node index.js
```
 <br />
This will start the process of indexing from block 0 to the latest block. The indexer will continuously listen for new blocks and index all the deployed LSP tokens. <br />

Currently indexer doesn't support EOA contract deployment i.e. contracts deployed through EOA are not tracked & indexed. As a temporary work around we've added manual indexing via *processContractsManually()* function. We've added *BurntPix* and *Universal Page Name* contracts as default since they're both deployed via EOA.

## Technical Deep Dive

The indexer is retrieving all transactions that have the Keymanager (LSP6) & Universal Factory (LSP16) topics:

```
const LSP6EventTopic = '0xa1fb700aaee2ae4a2ff6f91ce7eba292f89c2f5488b8ec4c5c5c8150692595c3';
const LSP16EventTopic = '0x8872a323d65599f01bf90dc61c94b4e0cc8e2347d6af4122fccc3e112ee34a84';
```

*These topics represent events emitted when a contract is deployed through Universal Profile or Universal Factory*

On Lukso, usually tokens are deployed through Universal Profiles. New projects launching on Lukso create their on-chain brand identity first - by deploying a UP - and through the UP are the tokens then created.
Sometimes brands utilize Universal Factory (LSP16) to deploy the token. This is to ensure that their tokens can be redeployed to Lukso L2s with the same address.

>To learn more about how LSP16 works visit [the Lukso docs](https://docs.lukso.tech/standards/generic-standards/lsp16-universal-factory)

Linked Contracts Factory (LSP23) can also be used to deploy a more complex token as it allows developers to deploy two inter-dependent contracts at the same time. But we don't track this yet as it's mostly used to deploy Universal Profiles, though it'll be added in the future.

>To learn more about how LSP23 works visit [the Lukso docs](https://docs.lukso.tech/standards/generic-standards/lsp16-universal-factory)

Envio's Hypersync returns all the transactions with the above topics in batches from block X to block Y. We then process the contracts by:

1. Checking if the deployed contract supports old LSP7 interface, new LSP7 interface or LSP8 interface. If one of them returns true, it means the deployed contract is an LSP token.
2. After we've identified LSP token contracts within the given batch, we then fetch the metadata from the Lukso's API endpoint, if there's no metadata we create a file named after the contract address in ./NoMetadata folder, otherwise we continue processing the metadata.
3. Once we've the metadata of the token, we determine its LSP standard and type. There are 3 token types on Lukso:<br />
   
   a) LSP7 token (divisible/fungible)<br />
   
   b) LSP7 NFT (non-divisible/non-fungible)<br />
   
   c) LSP8 NFT (non-divisible/non-fungible)<br />
   
   Since there can be LSP7 NFT and LSP8 NFT, we need to differentiate the two. For this, we check the appropriate metadata fields (tokenType, token, LSP4Standard...) to determine the standard (LSP7 or LSP8) and token type (token or NFT)
4. If it is LSP7 token or NFT, we create a folder under "./LSP7Divisible" || "./LSP7NonDivisible" with contract address as name and save the metadata as a json file. If it is an LSP8 NFT, then we also want to get token ID > CID mapping as well.
5. In case of LSP8, we query Pinata with CID hash of the directory that holds references to all the token IDs with their CID hashes and extract them to a simple .txt file. End result looks something like this: <br />

```
ID: 1, CID: bafkreib4rh2ij5rbf5ahkq7w3zkttdxd6yx5lqguqukhvroimle5z7qd54
ID: 2, CID: bafkreihamkxx66tgurar4bm57dvangwzupqkyn5w2w7akrt2ujmzupyqlq
ID: 3, CID: bafkreicrwvsov3jr25yalnaxehqi42pkgirijxw7gq2xjsci4xtft4mkyu
ID: 4, CID: bafkreiaupsxgp3nwskdiieekuga67pfmzmg7kb3ctkpduyt3vkxf6f4fhu
ID: 5, CID: bafkreihzxzrvte5vcsviigp4lr4hl3huiy375qyfyo3umeebnzuaslacsq
...
```

The tokenID > CID hash can be further processed with the following function:

```
// Fetches Metadata for individual Token IDs
// Extracts IPFS Image hash and downloads it
async function fetchNFTTokenMetadata(id, cid, directory) {
  try {
      const url = `${process.env.PINATA_PRIVATE_GATEWAY}${cid}?${process.env.PINATA_GATEWAY_KEY}`;
      const response = await fetch(url);
      const jsonData = await response.json(); // Assuming the data is JSON

      console.log(`Data for CID ${cid}:`, jsonData);

      // Extracting metadata
      const metadata = jsonData.LSP4Metadata;
      console.log(`Metadata for CID ${cid}:`, metadata);

      // Ensure the directory exists
      if (!fs.existsSync(directory)) {
          fs.mkdirSync(directory, { recursive: true });
      }

      // Saving the metadata to a JSON file within the specified directory
      const filePath = path.join(directory, `${id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
      console.log(`Metadata for CID ${cid} saved to ${filePath}`);
      
      // Handle image download if present
      if (metadata.images && metadata.images.length > 0 && metadata.images[0].length > 0) {
        const imageInfo = metadata.images[0][0];
        if (imageInfo && imageInfo.url) {
            const imagePath = path.join(directory, `${id}.png`);
            await downloadImage(imageInfo.url, imagePath);
        }
      }

      return metadata;
  } catch (error) {
      console.error(`Error fetching data for CID ${cid}:`, error);
  }
}
```

The above function is commented out as you can see:

```
/****************** Process only the first 5 ID and CID pairs for testing purposes ******************/ 

    // Here we call fetchNFTTokenMetadata which fetches metadata for each tokenID and saves them under /nfts folder
    /*for (let i = 0; i < Math.min(5, idCidPairs.length); i++) {
        const { id, cid } = idCidPairs[i];
        console.log(`Fetching metadata for token ID ${id} with CID ${cid}...`);
        await fetchNFTTokenMetadata(id, cid, nftDirectory);
    }*/
```

If you wish to go through the directory of an LSP8 NFT and fetch metadata & corresponding image of the token ID, you can uncomment the above and remove the limit. This will index not only the token metadata, the tokenID > CID pairs but also individual token ID metadata and image.

## Wrap up

Big thanks to Envio! They've been assisting us with setting up the indexer throughout the entire process from start to finish. Majority of the time the indexer is fetching and processing off-chain metadata as opposed to on-chain transactions. This speaks volumes on how fast Envio's Hypersync is!

If you've any questions regarding the indexer or anything else, feel free to reach out to us on [Commonground](https://app.cg/c/JErL2vNVPh/channel/~13NTr3pydFawzCj45UmXGD/)
