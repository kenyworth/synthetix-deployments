const crypto = require('crypto');
const assert = require('assert');
const { ethers } = require('ethers');
require('../../inspect');
const log = require('debug')(`e2e:${require('path').basename(__filename, '.e2e.js')}`);

const { getEthBalance } = require('../../tasks/getEthBalance');
const { setEthBalance } = require('../../tasks/setEthBalance');
const { wrapCollateral } = require('../../tasks/wrapCollateral');
const { getAccountOwner } = require('../../tasks/getAccountOwner');
const { createAccount } = require('../../tasks/createAccount');
const { getCollateralConfig } = require('../../tasks/getCollateralConfig');
const { getCollateralBalance } = require('../../tasks/getCollateralBalance');
const { getAccountCollateral } = require('../../tasks/getAccountCollateral');
const { isCollateralApproved } = require('../../tasks/isCollateralApproved');
const { approveCollateral } = require('../../tasks/approveCollateral');
const { depositCollateral } = require('../../tasks/depositCollateral');
const { delegateCollateral } = require('../../tasks/delegateCollateral');
const { doPriceUpdate } = require('../../tasks/doPriceUpdate');
const { setMainnetTokenBalance } = require('../../tasks/setMainnetTokenBalance');
const { syncTime } = require('../../tasks/syncTime');
const { getTokenBalance } = require('../../tasks/getTokenBalance');
const { transferToken } = require('../../tasks/transferToken');
const { distributeRewards } = require('../../tasks/distributeRewards');
const { getPoolOwner } = require('../../tasks/getPoolOwner');
const { getTokenRewardsDistributorInfo } = require('../../tasks/getTokenRewardsDistributorInfo');
const {
  getTokenRewardsDistributorRewardsAmount,
} = require('../../tasks/getTokenRewardsDistributorRewardsAmount');
const { getAvailableRewards } = require('../../tasks/getAvailableRewards');
const { claimRewards } = require('../../tasks/claimRewards');
const { setSpotWrapper } = require('../../tasks/setSpotWrapper');
const {
  configureMaximumMarketCollateral,
} = require('../../tasks/configureMaximumMarketCollateral');

const {
  contracts: {
    RewardsDistributorForSpartanCouncilPoolSNX: distributorAddress,
    SNXToken: payoutToken,
    CoreProxy: rewardManager,
    SynthUSDCToken: collateralType,
  },
} = require('../../deployments/meta.json');

log({ distributorAddress, payoutToken, rewardManager, collateralType });

describe(require('path').basename(__filename, '.e2e.js'), function () {
  const accountId = parseInt(`1337${crypto.randomInt(1000)}`);
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'http://127.0.0.1:8545'
  );
  const wallet = ethers.Wallet.createRandom().connect(provider);
  const address = wallet.address;
  const privateKey = wallet.privateKey;

  let snapshot;
  let initialBalance;
  let initialRewardsAmount;

  before('Create snapshot', async () => {
    snapshot = await provider.send('evm_snapshot', []);
    log('Create snapshot', { snapshot });

    initialBalance = await getTokenBalance({
      walletAddress: distributorAddress,
      tokenAddress: payoutToken,
    }).catch(console.error);

    log('Initial balance', { initialBalance });

    initialRewardsAmount = await getTokenRewardsDistributorRewardsAmount({ distributorAddress });
    log('Initial rewards amount', { initialRewardsAmount });
  });

  after('Restore snapshot', async () => {
    log('Restore snapshot', { snapshot });
    await provider.send('evm_revert', [snapshot]);
  });

  it('should sync time of the fork', async () => {
    await syncTime();
  });

  it('should validate Rewards Distributor info', async () => {
    const info = await getTokenRewardsDistributorInfo({ distributorAddress });
    assert.equal(info.name, 'Spartan Council Pool Rewards', 'name');
    assert.equal(info.poolId, 1, 'poolId');
    assert.equal(info.collateralType, collateralType, 'collateralType');
    assert.equal(
      `${info.payoutToken}`.toLowerCase(),
      `${payoutToken}`.toLowerCase(),
      'payoutToken'
    );
    assert.equal(info.precision, 10 ** 18, 'precision');
    assert.equal(`${info.token}`.toLowerCase(), `${payoutToken}`.toLowerCase(), 'token');
    assert.equal(info.rewardManager, rewardManager, 'rewardManager');
    assert.equal(info.shouldFailPayout, false, 'shouldFailPayout');
  });

  it('should create new random wallet', async () => {
    log({ wallet: wallet.address, pk: wallet.privateKey });
    assert.ok(wallet.address);
  });

  it('should set ETH balance to 100', async () => {
    assert.equal(await getEthBalance({ address }), 0, 'New wallet has 0 ETH balance');
    await setEthBalance({ address, balance: 100 });
    assert.equal(await getEthBalance({ address }), 100);
  });

  it('should create user account', async () => {
    assert.equal(
      await getAccountOwner({ accountId }),
      ethers.constants.AddressZero,
      'New wallet should not have an account yet'
    );
    await createAccount({ wallet, accountId });
    assert.equal(await getAccountOwner({ accountId }), address);
  });

  it(`should set USDC balance to 1_000`, async () => {
    const { tokenAddress } = await getCollateralConfig('USDC');
    assert.equal(
      await getCollateralBalance({ address, symbol: 'USDC' }),
      0,
      'New wallet has 0 USDC balance'
    );
    await setMainnetTokenBalance({
      wallet,
      balance: 1_000,
      tokenAddress,
      friendlyWhale: '0xcdac0d6c6c59727a65f871236188350531885c43',
    });
    assert.equal(await getCollateralBalance({ address, symbol: 'USDC' }), 1_000);
  });

  it('should approve USDC spending for SpotMarket', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'USDC',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      false,
      'New wallet has not allowed SpotMarket USDC spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'USDC',
      spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'USDC',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      true
    );
  });

  it('should increase max collateral for the test to 1_000_000_000_000', async () => {
    await configureMaximumMarketCollateral({
      marketId: require('../../deployments/extras.json').synth_usdc_market_id,
      symbol: 'USDC',
      targetAmount: String(1_000_000_000_000),
    });
    await setSpotWrapper({
      marketId: require('../../deployments/extras.json').synth_usdc_market_id,
      symbol: 'USDC',
      targetAmount: String(1_000_000_000_000),
    });
  });

  it(`should wrap 1_000 USDC`, async () => {
    const balance = await wrapCollateral({ wallet, symbol: 'USDC', amount: 1_000 });
    assert.equal(balance, 1_000);
  });

  it('should approve sUSDC spending for CoreProxy', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'sUSDC',
        spenderAddress: require('../../deployments/CoreProxy.json').address,
      }),
      false,
      'New wallet has not allowed CoreProxy sUSDC spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'sUSDC',
      spenderAddress: require('../../deployments/CoreProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'sUSDC',
        spenderAddress: require('../../deployments/CoreProxy.json').address,
      }),
      true
    );
  });

  it(`should deposit 1_000 sUSDC into the system`, async () => {
    assert.equal(await getCollateralBalance({ address, symbol: 'sUSDC' }), 1_000);
    assert.deepEqual(await getAccountCollateral({ accountId, symbol: 'sUSDC' }), {
      totalDeposited: 0,
      totalAssigned: 0,
      totalLocked: 0,
    });

    await depositCollateral({
      privateKey,
      symbol: 'sUSDC',
      accountId,
      amount: 1_000,
    });

    assert.equal(await getCollateralBalance({ address, symbol: 'sUSDC' }), 0);
    assert.deepEqual(await getAccountCollateral({ accountId, symbol: 'sUSDC' }), {
      totalDeposited: 1_000,
      totalAssigned: 0,
      totalLocked: 0,
    });
  });

  it('should make a price update', async () => {
    // We must sync timestamp of the fork before making price updates
    await syncTime();

    // delegating collateral and views requiring price will fail if there's no price update within the last hour,
    // so we send off a price update just to be safe
    await doPriceUpdate({
      wallet,
      marketId: 100,
      settlementStrategyId: require('../../deployments/extras.json').eth_pyth_settlement_strategy,
    });
    await doPriceUpdate({
      wallet,
      marketId: 200,
      settlementStrategyId: require('../../deployments/extras.json').btc_pyth_settlement_strategy,
    });
    await doPriceUpdate({
      wallet,
      marketId: 300,
      settlementStrategyId: require('../../deployments/extras.json').snx_pyth_settlement_strategy,
    });
    await doPriceUpdate({
      wallet,
      marketId: 400,
      settlementStrategyId: require('../../deployments/extras.json').sol_pyth_settlement_strategy,
    });
    await doPriceUpdate({
      wallet,
      marketId: 500,
      settlementStrategyId: require('../../deployments/extras.json').wif_pyth_settlement_strategy,
    });
    await doPriceUpdate({
      wallet,
      marketId: 600,
      settlementStrategyId: require('../../deployments/extras.json').w_pyth_settlement_strategy,
    });
  });

  it(`should delegate 1_000 sUSDC into the Spartan Council pool`, async () => {
    assert.deepEqual(await getAccountCollateral({ accountId, symbol: 'sUSDC' }), {
      totalDeposited: 1_000,
      totalAssigned: 0,
      totalLocked: 0,
    });
    await delegateCollateral({
      privateKey,
      symbol: 'sUSDC',
      accountId,
      amount: 1_000,
      poolId: 1,
    });
    assert.deepEqual(await getAccountCollateral({ accountId, symbol: 'sUSDC' }), {
      totalDeposited: 1_000,
      totalAssigned: 1_000,
      totalLocked: 0,
    });
  });

  it('should fund RewardDistributor with 1_000 SNX', async () => {
    await setMainnetTokenBalance({
      wallet,
      balance: 1_000,
      tokenAddress: payoutToken,
      friendlyWhale: '0xcc79bfa7a3212d94390c358e88afcd39294549ca',
    });

    await transferToken({
      privateKey,
      tokenAddress: payoutToken,
      targetWalletAddress: distributorAddress,
      amount: 1_000,
    });

    assert.equal(
      Math.floor(
        await getTokenBalance({ walletAddress: distributorAddress, tokenAddress: payoutToken })
      ),
      Math.floor(initialBalance + 1_000),
      'Rewards Distributor has 1_000 extra SNX on its balance'
    );
  });

  it('should distribute 1_000 SNX rewards', async () => {
    const poolId = 1;
    const poolOwner = await getPoolOwner({ poolId });
    log({ poolOwner });
    await setEthBalance({ address: poolOwner, balance: 100 });

    await provider.send('anvil_impersonateAccount', [poolOwner]);
    const signer = provider.getSigner(poolOwner);

    const amount = ethers.utils.parseUnits(`${1_000}`, 18); // the number must be in 18 decimals
    const start = Math.floor(Date.now() / 1_000);
    const duration = 10;

    await distributeRewards({
      wallet: signer,
      distributorAddress,
      poolId,
      collateralType,
      amount,
      start,
      duration,
    });

    await provider.send('anvil_stopImpersonatingAccount', [poolOwner]);

    assert.equal(
      await getTokenRewardsDistributorRewardsAmount({ distributorAddress }),
      initialRewardsAmount + 1_000,
      'should have 1_000 extra tokens in rewards'
    );
  });

  it('should claim SNX rewards', async () => {
    const poolId = 1;

    const availableRewards = await getAvailableRewards({
      accountId,
      poolId,
      collateralType,
      distributorAddress,
    });

    assert.ok(availableRewards > 0, 'should have some rewards to claim');

    assert.equal(
      await getTokenBalance({ walletAddress: address, tokenAddress: payoutToken }),
      0,
      'Wallet has 0 SNX balance BEFORE claim'
    );

    await claimRewards({
      wallet,
      accountId,
      poolId,
      collateralType,
      distributorAddress,
    });

    const postClaimBalance = await getTokenBalance({
      walletAddress: address,
      tokenAddress: payoutToken,
    });
    assert.ok(postClaimBalance > 0, 'Wallet has some non-zero SNX balance AFTER claim');

    assert.equal(
      Math.floor(await getTokenRewardsDistributorRewardsAmount({ distributorAddress })),
      Math.floor(initialRewardsAmount + 1_000 - postClaimBalance),
      'should deduct claimed token amount from total distributor rewards amount'
    );
  });
});
