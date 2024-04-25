const { HypersyncClient } = require("@envio-dev/hypersync-client");
const fs = require("node:fs");
const path = require('path');
const axios = require('axios');
const ethers = require('ethers');
const cheerio = require('cheerio');
const dotenv = require('dotenv')
const fetch = require('node-fetch');

dotenv.config();

const LUKSO_RPC = `https://lukso.nownodes.io/${process.env.NOWNODES_KEY}`;

const LSP6EventTopic = '0xa1fb700aaee2ae4a2ff6f91ce7eba292f89c2f5488b8ec4c5c5c8150692595c3';
const LSP16EventTopic = '0x8872a323d65599f01bf90dc61c94b4e0cc8e2347d6af4122fccc3e112ee34a84';
// Not supported yet
const LSP23EventTopic = '0xe20570ed9bda3b93eea277b4e5d975c8933fd5f85f2c824d0845ae96c55a54fe';

const LSP7InterfaceIdOld = '0xb3c4928f';
const LSP7InterfaceId = '0xc52d6008';
const LSP8InterfaceId = '0x3a271706';

async function main() {
  console.log(`🚀 Starting the main function...`);

  console.log(`🌐 Connecting to Hypersync Client...`);
  const client = HypersyncClient.new({
    url: "https://lukso.hypersync.xyz"
  });
  
  // Perform the query
  const query = {
      "fromBlock": 0,
      "logs": [
        {
          "topics": [
            ["0x8872a323d65599f01bf90dc61c94b4e0cc8e2347d6af4122fccc3e112ee34a84", "0xa1fb700aaee2ae4a2ff6f91ce7eba292f89c2f5488b8ec4c5c5c8150692595c3"],
            [],
            [],
            [],
          ]
        }
      ],
      "fieldSelection": {
          "block": ["number", "timestamp", "hash"],
          "transaction": ["block_number", "transaction_index", "hash", "from", "to", "value", "input"],
          "log": [
            "block_number",
            "log_index",
            "transaction_index",
            "data",
            "address",
            "topic0",
            "topic1",
            "topic2",
            "topic3"
          ]
      },
      transactions: [{}]
  };

  while(true) {
    console.log(`🔍 Starting the query from block 0 to block latest...`);
    const response = await client.sendReq(query);

    process.stdout.write(`QUERY ENDED ${response.nextBlock}\n`);
  
    // contractAddressBatch holds the transactions that have been found with the LSP6 & LSP16 topics
    const contractAddressBatch = response.data.logs;

    console.log(`📜 Extracting contract addresses from logs...`);
    // Extract and save the addresses from the contractAddressBatch
    const extractedAddresses = await extractContractAddresses(contractAddressBatch);

    // Check if the extracted addresses are either LSP7 or LSP8 contracts
    const lspTokens = await isLSPTokenContract(extractedAddresses);
    console.log("LSP Tokens", lspTokens)

    // For each LSP7 or LSP8 token, fetch metadata and determine the token standard and type and save them to the appropriate folder (LSP7Divisible, LSP7NonDivisible, LSP8NonDivisible)
    for (const contractAddress of lspTokens) {
      console.log(`Processing contract: ${contractAddress}`);
  
      try {
        const metadata = await processTokenMetadata(contractAddress);
        
        if (metadata) {
          await determineTokenStandardAndType(metadata, contractAddress);
        } else {
          console.log(`No metadata found for ${contractAddress}`);

          const directory = './NoMetadata';
          
          // Ensure the directory exists
          if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
          }

          const filePath = path.join(directory, `${contractAddress}.json`);
          const dataToWrite = JSON.stringify({ message: "no metadata" }, null, 2);

          fs.writeFileSync(filePath, dataToWrite, 'utf-8');
          console.log(`Saved file for ${contractAddress} in ${directory} with message 'no metadata'.`);
        }
      } catch (error) {
        console.error(`🚨 Error processing contract ${contractAddress}:`, error);
      }
    }
  
    console.log("Finished processing batch of contracts.");

    if (response.archiveHeight < response.nextBlock) {
      // wait if we are at the head
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    query.fromBlock = response.nextBlock;
  }
}

// Takes in a batch of hex strings extracted from the LSP6 & LSP16 topics and extracts the contract addresses, checksums and returns as an array
async function extractContractAddresses(contractAddressBatch) {
  const addresses = contractAddressBatch.map(log => {
    // Check the event type and extract the relevant address
    if (log.topics[0] === LSP6EventTopic) {
      //console.log("LSP6");
      return '0x' + log.topics[2].slice(-40);
    } else if (log.topics[0] === LSP16EventTopic) {
      //console.log("LSP16");
      return '0x' + log.topics[1].slice(-40);
    }
  }).filter(address => !!address);
 
  if (!addresses.length) {
    console.log(`⚠️  No addresses found in the logs.`);
  }

  // Convert addresses to checksummed format
  const checksummedAddresses = addresses.map(address => ethers.utils.getAddress(address));
  console.log(`✅ Extracted ${addresses.length} addresses.`);

  return checksummedAddresses;
}

// Takes in a batch of contract addresses and checks if they are LSP7 or LSP8 tokens by checking the supported interface
async function isLSPTokenContract(contractAddresses) {
  console.log(`🔎 Checking if contracts support LSP7 or LSP8 interfaces...`);

  const provider = new ethers.providers.JsonRpcProvider(LUKSO_RPC);
  let supportingContracts = [];

  for (const contractAddress of contractAddresses) {
    const contractInstance = new ethers.Contract(contractAddress, ['function supportsInterface(bytes4) external view returns (bool)'], provider);
    
    try {
      const isLSP7Old = await contractInstance.supportsInterface(LSP7InterfaceIdOld);
      console.log("isLSP7Old", isLSP7Old)
      const isLSP7 = await contractInstance.supportsInterface(LSP7InterfaceId);
      console.log("isLSP7", isLSP7)
      const isLSP8 = await contractInstance.supportsInterface(LSP8InterfaceId);
      console.log("isLSP8", isLSP8)

      if (isLSP7Old || isLSP7 || isLSP8) {
        supportingContracts.push(contractAddress);
      }
    } catch (error) {
      // Log the error and skip this contract if the supportsInterface method is not implemented
      console.error(`Contract at ${contractAddress} does not support supportsInterface or call failed: ${error.message}`);
      continue; // Skip to the next contract address
    }
  }

  if (!supportingContracts.length) {
    console.log(`⚠️  No supporting contracts found.`);
  }

  console.log(`✅ Found ${supportingContracts.length} supporting contracts.`);

  return supportingContracts;
}

// Fetches metadata for a given LSP asset from LUKSO's API
async function processTokenMetadata(contractAddress) {
  console.log(`🔄 Processing metadata for contract: ${contractAddress}...`);

  try {
      const response = await axios.get(`https://api.universalprofile.cloud/v1/42/address/${contractAddress}`, {
          headers: { 'Authorization': `Bearer ${process.env.LUKSO_API_KEY}` }
      });
      const metadata = response.data;

      if (metadata) {
        console.log(`📄 Metadata found for ${contractAddress}.`);
      } else {
          console.log(`❌ No metadata found for ${contractAddress}.`);
      }

      return metadata;
  } catch (error) {
      console.error(`Error fetching metadata for ${contractAddress}:`, error);
      return null;
  }
}

// Takes LSP7/8 token metadata and checks token standard/type fields to determine if it's LSP7 token, LSP7 NFT or LSP8 NFT
// Saves the metadata to a file in the respective directory (LSP7Divisible, LSP7NonDivisible, LSP8NonDivisible)
async function determineTokenStandardAndType(metadata, contractAddress) {
  console.log("🔄 Determening token standard and type")
  const { LSP4TokenType, LSPStandard, type, TokenType, tokenType,  address } = metadata;

  let lspType;
  let tokenTypeResolved;
  let directory;

  // Determine token standard and type based on the metadata
  if ((LSPStandard?.includes("LSP7") || type?.includes("LSP7DigitalAsset")) && (LSP4TokenType === "TOKEN" || TokenType === "Token" || tokenType === "TOKEN")) {
    lspType = 'LSP7';
    tokenTypeResolved = 'Token';
    directory = `./LSP7Divisible/${contractAddress}`;
    // send metadata with tokentype to backend API
    sendMetadataToAPI(metadata, "", "TOKEN")
  } else if ((LSPStandard?.includes("LSP7") || type?.includes("LSP7DigitalAsset")) && (LSP4TokenType === "NFT" || TokenType === "NFT" || tokenType === "NFT")) {
    lspType = 'LSP7';
    tokenTypeResolved = 'NFT';
    directory = `./LSP7NonDivisible/${contractAddress}`;
    // send metadata with tokentype to backend API
    sendMetadataToAPI(metadata, "", "NFT")
  } else if ((LSPStandard?.includes("LSP8") || type?.includes("LSP8DigitalAsset") || LSPStandard === "LSP8IdentifiableDigitalAsset") && (LSP4TokenType === "NFT" || TokenType === "NFT" || tokenType === "NFT")) {
    lspType = 'LSP8';
    tokenTypeResolved = 'NFT';
    directory = `./LSP8NonDivisible/${contractAddress}`;
    const nftDirectory = path.join(directory, 'nfts');
    ensureDirectoryExists(nftDirectory);
    const CID = await extractLSP8DirectoryCID(metadata);
    if (CID) {
      // first fetch id>cid mappings
      // then send it together with the metadata & the tokentype to backend API
        await fetchNFTDirectory(CID, nftDirectory, metadata);
    } else {
        console.log(`No valid directory hash found for ${contractAddress}, creating empty 'nfts' directory.`);
    }
  } else {
      lspType = 'Unsupported';
      tokenTypeResolved = 'Unsupported';
      directory = `./Unsupported/${contractAddress}`;
      sendMetadataToAPI(metadata, "", "Unknown")
      console.log(`Unsupported token type or standard. LSPStandard: ${LSPStandard}, TokenType: ${TokenType}, tokenType: ${tokenType}`);
  }

    // Ensure the directory exists
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    ensureDirectoryExists(directory);
    const filePath = path.join(directory, `metadata.json`);
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`Saved metadata for ${contractAddress} in ${directory}`);
}

function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
  }
}

// Function to extract the IPFS hash from the LSP8TokenMetadataBaseUri
async function extractLSP8DirectoryCID(metadata) {
  if (metadata.LSP8TokenMetadataBaseUri && !metadata.LSP8TokenMetadataBaseUri.NoDataInContract) {
    let baseUri = metadata.LSP8TokenMetadataBaseUri.Value;
    
    // Remove any trailing slash for consistent handling
    if (baseUri.endsWith('/')) {
      baseUri = baseUri.slice(0, -1);
    }

    const hash = baseUri.split('/').pop(); // Extract the last segment as the hash
    return hash;
  }
  return null; // Return null if no valid URI is found
}


// Fetches NFT directory for a given LSP8 NFT collection
// Returns all token IDs with their respective CIDs
// Also takes in metadata of the token itself
// And forwards it to backend API for processing
async function fetchNFTDirectory(CID, nftDirectory, metadata) {
  console.log(`🌐 Fetching NFT directory for CID ${CID}...`);

  try {
    const res = await fetch(`${process.env.PINATA_PRIVATE_GATEWAY}${CID}?${process.env.PINATA_GATEWAY_KEY}`);
    const htmlData = await res.text();
    const $ = cheerio.load(htmlData);
    let idCidPairs = [];

    $('div.nowrap').each((index, element) => {
        const title = $(element).attr('title');
        if (title && title.includes("Cumulative size of IPFS DAG")) {
            const cidLink = $(element).prev().find('a.ipfs-hash').attr('href');
            const cid = cidLink.split('/').pop().split('?')[0];
            const id = parseInt($(element).prev().prev().text().trim(), 10);
            idCidPairs.push({ id, cid });
        }
    });

    if (!idCidPairs.length) {
      console.log(`⚠️  No ID-CID pairs extracted from the NFT directory.`);
    }

    console.log(`✅ Extracted ${idCidPairs.length} ID-CID pairs from the NFT directory.`);

    // Sort by ID
    idCidPairs.sort((a, b) => a.id - b.id);
    
    ensureDirectoryExists(nftDirectory)

    // Save ID-CID pairs to a .txt file
    const idCidContent = idCidPairs.map(pair => `ID: ${pair.id}, CID: ${pair.cid}`).join('\n');
    fs.writeFileSync(path.join(nftDirectory, 'id-cid.txt'), idCidContent, 'utf8');
    console.log(`Saved ID-CID pairs to ${path.join(nftDirectory, 'id-cid.txt')}`);

    // Once we've fetched tokenID > CDI metadata and token metadata, we send it to backend for processing
    try {
      await sendMetadataToAPI(metadata, idCidPairs, "NFT")
    } catch (err) {
      console.log("Couldn't send metadata to backend API", err)
    }

    /****************** Process only the first 5 ID and CID pairs for testing purposes ******************/ 

    // Here we call fetchNFTTokenMetadata which fetches metadata for each tokenID and saves them under /nfts folder
    /*for (let i = 0; i < Math.min(5, idCidPairs.length); i++) {
        const { id, cid } = idCidPairs[i];
        console.log(`Fetching metadata for token ID ${id} with CID ${cid}...`);
        await fetchNFTTokenMetadata(id, cid, nftDirectory);
    }*/
  } catch (error) {
      console.error('Error:', error);
  }
}

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

// Downloads the image from the provided CID hash and saves it to the specified path
async function downloadImage(imageUrl, savePath) {
  const firstAttemptUrl = imageUrl.replace('ipfs://', `${process.env.PINATA_PRIVATE_GATEWAY}`) + `?${process.env.PINATA_GATEWAY_KEY}`;
  const secondAttemptUrl = imageUrl.replace('ipfs://', 'https://api.universalprofile.cloud/ipfs/'); // Lukso's public API gateway as an alternative

  try {
    console.log(`📥 Attempting to download image from ${firstAttemptUrl}`);

    await tryDownloadImage(firstAttemptUrl, savePath);
    
    console.log(`🖼 Image saved to ${savePath} on first try`);
  } catch (error) {

    console.error(`First attempt failed for ${firstAttemptUrl}: ${error.message}`);
    console.log(`🔄 Attempting second source: ${secondAttemptUrl}`);
    try {
      await tryDownloadImage(secondAttemptUrl, savePath);

      console.log(`🖼 Image saved to ${savePath} on second try`);
    } catch (error) {
      console.error(`Second attempt failed for ${secondAttemptUrl}: ${error.message}`);
      // Continue processing even if both attempts fail
    }
  }
}

// If our Pinata gateway fails, we can try to fetch the image from universal cloud
async function tryDownloadImage(url, savePath) {
  const response = await fetch(url);
  console.log(`Status Code: ${response.status} - ${response.statusText}`);  // Log status code
  console.log(`Content-Type: ${response.headers.get('content-type')}`);    // Log content type

  if (!response.ok) {
    throw new Error(`Failed to fetch image: Status code ${response.status}`);
  }

  const buffer = await response.buffer();
  fs.writeFileSync(savePath, buffer);
  console.log(`Image saved to ${savePath}`);
}

/******************************
  LOGIC FOR INTERACTING WITH BACKEND API TO POPULATE THE DATABASE
******************************/

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

/******************************
  LOGIC FOR POPULATING EMPTY DATABASE WITH ALREADY INDEXED TOKEN METADATA
  USEFUL WHEN YOU'VE ALREADY INDEXED AND JUST WANT TO POPULATE DATABASE
******************************/

// Directories containing token metadata
const directories = ['./LSP7Divisible', './LSP7NonDivisible', './LSP8NonDivisible'];

// Main function to process all token metadata in LSP7Divisible, LSP7NonDivisible and LSP8NonDivisible directories
async function processAllDirectories() {
  for (const directory of directories) {
      if (fs.existsSync(directory)) {
          await processDirectory(directory);
      } else {
          console.log(`Directory ${directory} does not exist.`);
      }
  }
}

async function processDirectory(directoryPath) {
  const contractDirectories = fs.readdirSync(directoryPath);

  for (const contractDir of contractDirectories) {
      const contractPath = path.join(directoryPath, contractDir);
      const nftsDirectoryPath = path.join(contractPath, 'nfts');
      let idCidPairs = "";

      // Check if the nfts directory exists and load idCidPairs if it does
      if (fs.existsSync(nftsDirectoryPath)) {
          const idCidPairsPath = path.join(nftsDirectoryPath, 'id-cid.txt');
          if (fs.existsSync(idCidPairsPath)) {
              idCidPairs = fs.readFileSync(idCidPairsPath, 'utf8');
          }
      }

      // Read JSON metadata files in each contract directory
      const files = fs.readdirSync(contractPath);
      for (const file of files) {
          if (file.endsWith('.json')) {  // Ensure processing only JSON files
              const fullPath = path.join(contractPath, file);
              const metadata = readJsonFile(fullPath);
              if (metadata) {
                  const tokenType = directoryPath.includes('Divisible') ? 'TOKEN' : 'NFT';
                  await sendMetadataToAPI(metadata, idCidPairs, tokenType);
              }
          }
      }
  }
}

function readJsonFile(filePath) {
  try {
      const fileContents = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(fileContents);
  } catch (error) {
      console.error('Error reading JSON file:', filePath, error);
      return null;
  }
}

/******************************
  UNCOMMENT THE APPROPRIATE FUNCTION

  MAIN() FOR INDEXING ALL TOKEN DEPLOYMENTS FROM BLOCK 0
  PROCESSALLDIRECTORIES FOR POPULATING EMPTY DATABASE WITH ALREADY INDEXED METADATA
******************************/


// Run this in case you already indexed up to X block and want to re-populate the database
//processAllDirectories();

// Run this if you want to index the chain indefinitely starting from block 0
//main();