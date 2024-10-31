'use client'

import { useState, useEffect } from 'react'
import TokenBankABI from './abi/TokenBank.json'
import Permit2ABI from './abi/Permit2.json'
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

      setSuccess('Deposit successful!')
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
            <div>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount to deposit"
                className="border p-2 rounded mr-2 bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleDepositWithPermit2}
                disabled={loading}
                className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
              >
                {loading ? 'Processing...' : 'Deposit with Permit2'}
              </button>
            </div>
            {error && <p className="text-red-500">{error}</p>}
            {success && <p className="text-green-500">{success}</p>}
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
