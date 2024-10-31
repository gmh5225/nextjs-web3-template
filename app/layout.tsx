'use client'

import { WagmiProvider, createConfig, http } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { arbitrumSepolia } from 'viem/chains'
import localFont from 'next/font/local'
import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  display: 'swap',
  weight: '100 900',
})

// Create query client
const queryClient = new QueryClient()

// Create wagmi config
const config = createConfig({
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http(),
  },
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <body className={geistSans.className}>{children}</body>
        </QueryClientProvider>
      </WagmiProvider>
    </html>
  )
}
