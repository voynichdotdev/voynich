'use client'

import { useEffect } from 'react'
import { wallet, registerLocalWallet } from '@/lib/wallet'
import { Toasts } from '@/components/ui/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerLocalWallet().then(() => wallet.start())
  }, [])
  return (
    <>
      {children}
      <Toasts />
    </>
  )
}
