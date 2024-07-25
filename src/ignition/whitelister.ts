import console from "console";
import {SigningCosmWasmClient} from "@cosmjs/cosmwasm-stargate";
import {DirectSecp256k1HdWallet} from "@cosmjs/proto-signing";
import {Network} from "../enums/network";
import {CSV_DIR, DEFAULT_GAS_PRICE, MAINNET_RPC, SIMULATION_DIR, TESTNET_RPC} from "../constants/constants";

type WhitelistItem = {
    address: string;
    minimum_amount: string;
    maximum_amount: string;
}

type WalletAllocation = {
    wallet:string,
    min:number,
    max:number
}

const csv = require('csv-parser')
const fs = require('fs')
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Configuration Variables ***************************************************************************************************

// The path to the csv with the address whitelisting allocations
// Values entered into the min and max fields must be specified in the purchasing denom (eg: USK).
// You are specifying a min and max purchase allowance in the bid denom, not a min and max amount
// of tokens the wallet can purchase.
const whitelistCsvPath = `${CSV_DIR}\\sample-whitelist.csv`

// The number of addresses to include in each whitelisting batch. Max 500 address per batch.
const batchSize = 2

// The id of the Ignition sale to whitelist against
const dealId = 436

// The mnemonic of the signing wallet. This wallet needs to be the creator wallet of the Ignition deal
const mnemonic = ''

const network = Network.TESTNET

// The address of the contract to run the whitelisting against
const contractAddress = 'kujira1h8ejpffnfcv0q5pyw3qre942hlpqx3vuv0ahl7krjdz5ny07jx9sm53qgk'
// testnet contract: kujira1h8ejpffnfcv0q5pyw3qre942hlpqx3vuv0ahl7krjdz5ny07jx9sm53qgk
// mainnet contract: kujira1wr50e56t3t3f3vxp6fs9sneggh2at6qg3anyu22pd0ud7vrhs09q0vq6rv

// A flag to enable or disable a simulation run. When set to true no transactions will be signed and
// the outputs will be written to file for you to validate.
const simulate = true

// The exponent of the purchasing denom token
const tokenExponent = 6

// End Configuration Variables ***********************************************************************************************

const getRPC = ():string => {
    // @ts-ignore
    return network === Network.MAINNET ? MAINNET_RPC : TESTNET_RPC
}

const writeResults = (allocations:WhitelistItem[], batch:number) => {
    const csvWriter = createCsvWriter({
        path: `./${SIMULATION_DIR}\\test_allocations_${batch}.csv`,
        header: [
            {id: 'address', title: 'address'},
            {id: 'maximum_amount', title:'maximum_amount'},
            {id: 'minimum_amount', title:'minimum_amount'},
        ]
    });

    csvWriter.writeRecords(allocations)
        .then(() => {
            console.log('Simulation results written.')
        })
}

const processCsv = () =>{
    const results:WalletAllocation[] = [];

    fs.createReadStream(whitelistCsvPath)
        .pipe(csv())
        .on('data', (data:WalletAllocation) => results.push(data))
        .on('end', () => {
            runWhitelisting(results).then(() =>{
                console.log('Whitelisting complete')
            })
        });
}

const runWhitelisting = async (allocations:WalletAllocation[]) => {
    console.log(`Running whitelisting for ${allocations.length} wallets`)
    console.log(allocations)

    let walletAddress = ''
    let cwClient:SigningCosmWasmClient|undefined = undefined

    if(!simulate) {
        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {prefix: 'kujira'})
        const accounts = await wallet.getAccounts()
        walletAddress = accounts[0].address

        cwClient = await SigningCosmWasmClient.connectWithSigner(getRPC(), wallet, {gasPrice: DEFAULT_GAS_PRICE})
    }

    let processed = 0
    while(processed < allocations.length){
        console.log('Processing batch...')
        await runWhitelistBatch(processed, batchSize, allocations, cwClient, walletAddress)
        processed = processed + batchSize

        if(processed < allocations.length) {
            console.log(`${processed} of ${allocations.length} processed.`)
        }
        else{
            console.log(`${allocations.length} of ${allocations.length} processed.`)
        }
    }
}

const getWhitelistActionExecute = (id: number, whitelist: WhitelistItem[], remove: boolean): Record<string, unknown> => {
    return {
        whitelist_action: {
            id: id,
            whitelist: whitelist,
            remove: remove,
        }
    }
}

const runWhitelistBatch = async (startIndex:number, count:number, allocations:WalletAllocation[], cwClient?:SigningCosmWasmClient | undefined, walletAddress?:string) => {
    const whitelist:WhitelistItem[] = []
    for(let i = startIndex; i < (startIndex + count); i++) {

        if (i === allocations.length) {
            break
        }

        const whitelistedAddress: WhitelistItem = {
            address: allocations[i].wallet,
            maximum_amount: `${Math.floor(allocations[i].max * Math.pow(10, tokenExponent))}`,
            minimum_amount: `${Math.floor(allocations[i].min * Math.pow(10, tokenExponent))}`
        }

        whitelist.push(whitelistedAddress)
    }

    if(simulate) {
        writeResults(whitelist, startIndex/count)
        console.log('Batch simulation written')
    } else if (cwClient && walletAddress) {
        const msg = getWhitelistActionExecute(dealId, whitelist, false)
        await cwClient.execute(walletAddress, contractAddress, msg, "auto")
        console.log('Batch processed on chain')
    } else {
        console.log('Could not process batch as either the cwClient or walletAddress provided have not been initialised.')
    }
}

(async () => {
    try{
        processCsv()
    }
    catch (error) {
        console.log(error)
    }
})()