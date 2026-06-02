import 'dotenv/config';
import { paidSearch, getWalletAddress } from '../payment.js';

async function main() {
  console.log('USE_X402:', process.env.USE_X402);
  console.log('Initializing wallet...');

  const address = await getWalletAddress();
  console.log('Wallet address:', address);
  if (address) {
    console.log('BaseScan:', `https://basescan.org/address/${address}`);
  }

  console.log('\nRunning test search: "What is x402 payment protocol?"');
  const result = await paidSearch('What is x402 payment protocol?', {}, 'test');

  const data = result.data as Record<string, unknown>;
  const results = (data?.results ?? []) as Array<{ title: string; url: string }>;

  console.log('\n--- Results ---');
  results.slice(0, 3).forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    ${r.url}`);
  });

  console.log('\n--- Payment Receipt ---');
  console.log('Cost: $' + result.costUsd.toFixed(4));
  if (result.txHash) {
    console.log('Tx hash:', result.txHash);
    console.log('BaseScan:', `https://basescan.org/tx/${result.txHash}`);
  } else {
    console.log('(No tx hash — free dev key mode)');
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
