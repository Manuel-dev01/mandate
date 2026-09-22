import type { Metadata } from 'next'
import { JetBrains_Mono, Newsreader } from 'next/font/google'
import type { ReactNode } from 'react'
import { Header } from '@/components/header'
import './globals.css'

const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })
const serif = Newsreader({ subsets: ['latin'], weight: ['400'], style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' })

export const metadata: Metadata = {
  title: 'Mandate — audit console',
  description: 'Every decision the treasury agent made, allowed or refused, with the receipt that proves it.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable}`}>
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  )
}
