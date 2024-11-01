'use client'

import { useState, useEffect } from 'react'
import TokenBankABI from './abi/TokenBank.json'
import Permit2ABI from './abi/Permit2.json'
import ERC20ABI from './abi/ERC20.json'
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useWalletClient,
  usePublicClient,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseEther, type Hash, type Address } from 'viem'
import { keccak256, encodeAbiParameters, concat } from 'viem'

export default function Home() {
  // Contract addresses
  const BANK_ADDRESS = '0xdB3eF3cB3079C93A276A2B4B69087b8801727f64' as const
  const TOKEN_ADDRESS = '0xe4Cec63058807C50C95CEF99b0Ab5A9831610386' as const
  const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

  // State variables
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [mounted, setMounted] = useState(false)
  const [bankBalance, setBankBalance] = useState<string>('')
  const [isApproving, setIsApproving] = useState(false)
  const [approveSuccess, setApproveSuccess] = useState(false)
  const [supportsEIP2612, setSupportsEIP2612] = useState<boolean | null>(null)
  const [isCheckingSupport, setIsCheckingSupport] = useState(false)
  const [tokenBalance, setTokenBalance] = useState<string>('')

  // Wagmi hooks
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true)
  }, [])

  // Check and approve Permit2
  const checkAndApprovePermit2 = async (amount: bigint) => {
    if (!walletClient || !address) throw new Error('Wallet not connected')
    if (!publicClient) throw new Error('Public client not available')

    const allowance = (await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20ABI,
      functionName: 'allowance',
      args: [address as Address, PERMIT2_ADDRESS],
    })) as bigint

    if (allowance < amount) {
      setIsApproving(true)
      const hash = await walletClient.writeContract({
        address: TOKEN_ADDRESS,
        abi: ERC20ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, BigInt(2) ** BigInt(256) - BigInt(1)],
      })

      await publicClient.waitForTransactionReceipt({ hash })
      setApproveSuccess(true)
      setIsApproving(false)
    }
  }

  // Handle deposit with permit2
  const handleDepositWithPermit2 = async () => {
    try {
      setLoading(true)
      setError('')
      setSuccess('')

      if (!walletClient) throw new Error('Please connect your wallet')
      if (!address) throw new Error('Please connect your wallet')
      if (!publicClient) throw new Error('Public client not available')

      // Convert amount to wei
      const amountWei = parseEther(amount)

      // Check and approve Permit2
      await checkAndApprovePermit2(amountWei)

      // Get nonce
      const wordPos = BigInt(0)
      const bitmap = await publicClient.readContract({
        address: PERMIT2_ADDRESS,
        abi: Permit2ABI,
        functionName: 'nonceBitmap',
        args: [address as Address, wordPos],
      })

      const nonce = findNextNonce(bitmap as bigint, wordPos)

      // Set deadline to 1 hour from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      // Create permit message
      const domain = {
        name: 'Permit2',
        chainId,
        verifyingContract: PERMIT2_ADDRESS,
      }

      const types = {
        PermitTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        TokenPermissions: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      }

      const value = {
        permitted: {
          token: TOKEN_ADDRESS,
          amount: amountWei,
        },
        spender: BANK_ADDRESS,
        nonce,
        deadline,
      }

      // Get signature
      const signature = await walletClient.signTypedData({
        account: address as Address,
        domain,
        types,
        primaryType: 'PermitTransferFrom',
        message: value,
      })

      // Execute deposit
      const hash = await walletClient.writeContract({
        address: BANK_ADDRESS,
        abi: TokenBankABI,
        functionName: 'depositWithPermit2',
        args: [amountWei, nonce, deadline, signature as Hash],
      })

      // Wait for transaction
      await publicClient.waitForTransactionReceipt({ hash })

      setSuccess('Deposit with Permit2 successful!')

      // fetch balances
      await Promise.all([
        fetchBankBalance(),
        fetchTokenBalance(), // refresh token balance
      ])
    } catch (err: any) {
      console.error('Error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Helper function to find next nonce
  const findNextNonce = (bitmap: bigint, wordPos: bigint): bigint => {
    for (let bit = BigInt(0); bit < BigInt(256); bit++) {
      if (!(bitmap & (BigInt(1) << bit))) {
        return (wordPos << BigInt(8)) | bit
      }
    }
    throw new Error('No available nonce found')
  }

  // get bank balance
  const fetchBankBalance = async () => {
    try {
      if (!publicClient || !address) return

      const balance = await publicClient.readContract({
        address: BANK_ADDRESS,
        abi: TokenBankABI,
        functionName: 'getBalance',
      })

      // format balance
      const formattedBalance = (Number(balance) / 1e18).toString()
      setBankBalance(formattedBalance)
    } catch (err: any) {
      console.error('Error fetching balance:', err)
      setError('Failed to fetch balance')
    }
  }

  // check if the token supports EIP2612
  const checkEIP2612Support = async (
    contractAddress: Address
  ): Promise<boolean> => {
    if (!publicClient) return false
    setIsCheckingSupport(true)
    try {
      await publicClient.readContract({
        address: contractAddress,
        abi: [
          {
            inputs: [],
            name: 'DOMAIN_SEPARATOR',
            outputs: [{ type: 'bytes32', name: '' }],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        functionName: 'DOMAIN_SEPARATOR',
      })
      setSupportsEIP2612(true)
      return true
    } catch {
      setSupportsEIP2612(false)
      return false
    } finally {
      setIsCheckingSupport(false)
    }
  }

  // check if the token supports EIP2612 after connecting wallet
  useEffect(() => {
    if (isConnected && publicClient) {
      checkEIP2612Support(TOKEN_ADDRESS)
    }
  }, [isConnected, publicClient])

  // deposit function, choose different deposit methods based on token type
  const handleDeposit = async () => {
    try {
      setLoading(true)
      setError('')

      if (!walletClient || !address) throw new Error('Wallet not connected')
      if (!publicClient) throw new Error('Public client not available')

      const amountWei = parseEther(amount)

      // check if the token supports EIP2612
      const supportsEIP2612 = await checkEIP2612Support(TOKEN_ADDRESS)

      if (supportsEIP2612) {
        // use permitDeposit
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

        // get signature
        const { v, r, s } = await getEIP2612Signature(
          address,
          BANK_ADDRESS,
          amountWei,
          deadline
        )

        // call permitDeposit
        const hash = await walletClient.writeContract({
          address: BANK_ADDRESS,
          abi: TokenBankABI,
          functionName: 'permitDeposit',
          args: [amountWei, deadline, v, r, s],
        })

        await publicClient.waitForTransactionReceipt({ hash })
      } else {
        // use permit2
        await handleDepositWithPermit2()
      }

      setSuccess('Deposit successful!')
    } catch (err: any) {
      console.error('Error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // get EIP2612 signature
  const getEIP2612Signature = async (
    owner: Address,
    spender: Address,
    amount: bigint,
    deadline: bigint
  ) => {
    if (!walletClient || !publicClient) throw new Error('Wallet not connected')

    const nonce = (await publicClient.readContract({
      address: TOKEN_ADDRESS,
      abi: ERC20ABI,
      functionName: 'nonces',
      args: [owner],
    })) as bigint

    // build EIP-712 data
    const domain = {
      name: await publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: ERC20ABI,
        functionName: 'name',
      }),
      version: '1',
      chainId,
      verifyingContract: TOKEN_ADDRESS,
    }

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    }

    const value = {
      owner,
      spender,
      value: amount,
      nonce,
      deadline,
    }

    // use signTypedData to sign the data
    const signature = await walletClient.signTypedData({
      domain: domain as any,
      types,
      primaryType: 'Permit',
      message: value,
    })

    // decompose the signature into v, r, s
    const r = `0x${signature.slice(2, 66)}`
    const s = `0x${signature.slice(66, 130)}`
    const v = parseInt(signature.slice(130, 132), 16)

    return { v, r: r as `0x${string}`, s: s as `0x${string}` }
  }

  // handle permitDeposit
  const handlePermitDeposit = async () => {
    try {
      setLoading(true)
      setError('')
      setSuccess('')

      if (!walletClient || !address) throw new Error('Wallet not connected')
      if (!publicClient) throw new Error('Public client not available')

      const amountWei = parseEther(amount)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      // get signature
      const { v, r, s } = await getEIP2612Signature(
        address,
        BANK_ADDRESS,
        amountWei,
        deadline
      )

      // call permitDeposit
      const hash = await walletClient.writeContract({
        address: BANK_ADDRESS,
        abi: TokenBankABI,
        functionName: 'permitDeposit',
        args: [amountWei, deadline, v, r, s],
      })

      await publicClient.waitForTransactionReceipt({ hash })
      setSuccess('Deposit with EIP2612 successful!')

      // fetch balances
      await Promise.all([
        fetchBankBalance(),
        fetchTokenBalance(), // refresh token balance
      ])
    } catch (err: any) {
      console.error('Error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // fetch token balance
  const fetchTokenBalance = async () => {
    try {
      if (!publicClient || !address) return

      const balance = await publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: ERC20ABI,
        functionName: 'balanceOf',
        args: [address],
      })

      // format balance
      const formattedBalance = (Number(balance) / 1e18).toString()
      setTokenBalance(formattedBalance)
    } catch (err: any) {
      console.error('Error fetching token balance:', err)
      setError('Failed to fetch token balance')
    }
  }

  // fetch token balance after connecting wallet
  useEffect(() => {
    if (isConnected && publicClient) {
      fetchTokenBalance()
    }
  }, [isConnected, publicClient])

  if (!mounted) {
    return null
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8">TokenBank Deposit</h1>

        {!isConnected ? (
          <button
            onClick={() => connect({ connector: injected() })}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Connect Wallet
          </button>
        ) : (
          <div className="space-y-4">
            <p>Connected: {address}</p>

            {/* Token Balance with Refresh Button */}
            <div className="flex items-center space-x-4">
              <p className="text-lg">Your token balance: {tokenBalance} Tokens</p>
              <button
                onClick={() =>
                  Promise.all([fetchTokenBalance(), fetchBankBalance()])
                }
                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-sm"
              >
                🔄 Refresh Balances
              </button>
            </div>

            {/* Amount Input */}
            <div className="mb-4">
              <input
                type="number"
                value={amount}
                onChange={(e) => {
                  // input validation
                  const value = e.target.value
                  if (Number(value) > Number(tokenBalance)) {
                    setError('Amount exceeds balance')
                  } else {
                    setError('')
                  }
                  setAmount(value)
                }}
                placeholder="Amount of tokens to deposit"
                className="border p-2 rounded mr-2 bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Deposit Buttons */}
            <div className="space-x-4">
              <button
                onClick={handleDepositWithPermit2}
                disabled={loading || isApproving}
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
              >
                {isApproving
                  ? 'Approving Permit2...'
                  : loading
                    ? 'Processing...'
                    : 'Deposit with Permit2'}
              </button>

              {supportsEIP2612 && (
                <button
                  onClick={handlePermitDeposit}
                  disabled={loading}
                  className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                  {loading ? 'Processing...' : 'Deposit with EIP2612'}
                </button>
              )}
            </div>

            {/* Status Messages */}
            {isApproving && (
              <p className="text-yellow-500">
                Approving Permit2 for first-time use...
              </p>
            )}
            {approveSuccess && (
              <p className="text-green-500">Successfully approved Permit2!</p>
            )}
            {error && <p className="text-red-500">{error}</p>}
            {success && <p className="text-green-500">{success}</p>}

            {/* Balance Check */}
            <div className="flex items-center space-x-4 mt-4">
              <button
                onClick={fetchBankBalance}
                className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
              >
                Check Balance
              </button>
              {bankBalance && (
                <p className="text-lg">Bank Balance: {bankBalance} Tokens</p>
              )}
            </div>

            <button
              onClick={() => disconnect()}
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
