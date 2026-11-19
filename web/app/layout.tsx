import type { Metadata, Viewport } from 'next'
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { PRODUCT } from '@/lib/facts'
import { siteUrl } from '@/lib/env'
import { Nav } from '@/components/nav/Nav'
import { Footer } from '@/components/nav/Footer'
import { DryEdge } from '@/components/drawn/Drawn'
import { Providers } from '@/components/Providers'

const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' })

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${PRODUCT.name}: sealed models on Solana`, template: `%s · ${PRODUCT.name}` },
    description: PRODUCT.description,
    openGraph: { title: `${PRODUCT.name}: ${PRODUCT.line}`, description: PRODUCT.description, type: 'website', siteName: PRODUCT.name },
    twitter: { card: 'summary_large_image', title: `${PRODUCT.name}: ${PRODUCT.line}`, description: PRODUCT.description },
  }
}
export const viewport: Viewport = { themeColor: '#05080f', colorScheme: 'dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${jetbrains.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <DryEdge />
        <Providers>
          <Nav />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
