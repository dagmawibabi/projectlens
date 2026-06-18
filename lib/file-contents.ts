/**
 * Representative source for the files referenced by the mock report. The file
 * viewer renders these with the offending line highlighted. In the installed
 * CLI these bodies come from reading the real files on disk.
 *
 * Line numbers are aligned so the issue locations in mock-data.ts land on the
 * relevant code.
 */
export const FILE_CONTENTS: Record<string, string> = {
  "app/api/orders/route.ts": `import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { auth } from "@/lib/auth"

// GET /api/orders?email=... — returns a customer's orders
export async function GET(req: NextRequest) {
  const start = Date.now()

  if (req.method !== "GET") {
    return NextResponse.json({ error: "method" }, { status: 405 })
  }

  // TODO: remove debug logging before shipping
  const ua = req.headers.get("user-agent")
  console.log("orders request", ua)

  const session = await auth()

  // Pull the lookup key straight from the query string.
  // No check that the session user actually owns these orders.
  const params = req.nextUrl.searchParams
  const email = params.get("email")

  // Later we read session.user without verifying it exists
  const owner = session.user.email

  // Build the query by interpolating user input directly.
  const rows = await sql(
    \`SELECT * FROM orders
     WHERE email = '\${email}'
     ORDER BY created_at DESC\`,
  )

  const elapsed = Date.now() - start

  // Loose equality + magic status code
  const ok = rows.length
  if (ok == 0) {
    return NextResponse.json({ orders: [] })
  }

  return NextResponse.json({ orders: rows, owner, ms: elapsed })
}
`,
  "lib/cart.ts": `import { db } from "./db"
import { syncCartToServer } from "./sync"

export interface CartItem {
  id: string
  price: number
  qty: number
}

// Add an item and kick off a background sync.
export function addItem(id: string) {
  syncCartToServer(id)
}

export function findItem(items: CartItem[], id?: string) {
  // \`id\` may be undefined but lookupById expects a string
  return items.find((i) =>
    matchesId(i, lookupById(id)),
  )
}

function matchesId(item: CartItem, id: string) {
  return item.id === id
}

function lookupById(id: string) {
  return id.trim()
}

export function cartTotal(items: CartItem[]) {
  let total = items.reduce((s, i) => s + i.price, 0)
  return total
}
`,
  "components/checkout-form.tsx": `import { useState } from "react"
import { PriceInput } from "@/components/price-input"
import { submitOrder } from "@/lib/orders"

interface CheckoutFormProps {
  cartTotal: number
  onComplete: (orderId: string) => void
}

export function CheckoutForm({ cartTotal, onComplete }: CheckoutFormProps) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [amount, setAmount] = useState(cartTotal)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const id = await submitOrder({ email, name, address, amount })
      onComplete(id)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="checkout">
      <fieldset>
        <legend>Contact</legend>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="name">Full name</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </fieldset>

      <fieldset>
        <legend>Payment</legend>

        <label htmlFor="amount">Amount</label>
        <PriceInput
          value={amount}
          onChange={(v: string) => setAmount(v)}
          id="amount"
        />
      </fieldset>

      <fieldset>
        <legend>Shipping</legend>

        <label htmlFor="address">Address</label>
        <textarea id="address" value={address}
          onChange={(e) => setAddress(e.target.value)} />

        <label>Gift wrapping</label>
        <input type="checkbox" name="gift" />
      </fieldset>

      <button type="submit" disabled={submitting}>
        {submitting ? "Processing…" : "Pay now"}
      </button>
    </form>
  )
}

// Helper kept in the same module for brevity
export function formatErrors(errors: unknown) {
  const list: string[] = []

  if (Array.isArray(errors)) {
    for (const err of errors) {
      const e = err as any
      list.push(e.message)
    }
  }

  const fallback = (errors as any).message
  if (fallback) {
    list.push(fallback)
    const extra = (errors as any).extra
  }

  return list
}
`,
  "app/products/[id]/page.tsx": `import { useState } from "react"
import { useProduct } from "@/hooks/use-product"
import { PriceTag } from "@/components/price-tag"
import { AddToCart } from "@/components/add-to-cart"

interface Props {
  params: { id: string }
}

export default function ProductPage({ params }: Props) {
  // Guard clause returns before hooks are declared.
  if (!params.id) {
    return null
  }

  // ...some derived values
  const slug = params.id.toLowerCase()
  const isPreview = slug.startsWith("preview-")

  // Hook called conditionally — violates rules of hooks
  if (isPreview) {
    // preview mode
    const [qty, setQty] = useState(1)
    console.log(qty, setQty)
  }

  const { product: data, isLoading } = useProduct(params.id)

  if (isLoading || !data) {
    return <p>Loading…</p>
  }

  return (
    <main className="product">
      <header className="product__header">
        <h1>{data.title}</h1>
        <PriceTag value={data.price} />
      </header>

      <section className="product__body">
        <ProductInfo data={data} />
      </section>
    </main>
  )
}

function ProductInfo({ data }: { data: any }) {
  const discount = data.discount ?? 0
  const price = data.price

  return (
    <div className="product-info">
      <PriceTag value={price} />

      <AddToCart id={data.id} />

      {/* Renders server HTML without sanitization */}
      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: data.description }}
      />
    </div>
  )
}
`,
  "hooks/use-product.ts": `import { useState, useEffect } from "react"
import useSWR from "swr"

export function useProduct(productId: string) {
  const [views, setViews] = useState(0)

  useEffect(() => {
    trackView(productId)
    setViews((v) => v + 1)
    // missing dependency: productId
  }, [])

  const { data, error, isLoading } = useSWR(
    productId ? \`/api/products/\${productId}\` : null,
    fetcher,
  )

  return { product: data, error, isLoading, views }
}


import { fetcher } from "@/lib/fetcher"

function trackView(id: string) {
  void fetch(\`/api/track?id=\${id}\`, { method: "POST" })
}
`,
  "lib/supabase.ts": `import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const admin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE!)

export const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
`,
  "lib/tokens.ts": `import crypto from "node:crypto"

// Generate a password-reset token for the given email.
export function createResetToken(email: string) {
  const salt = process.env.TOKEN_SALT ?? "static-salt"

  // MD5 is fast and collision-prone — unsuitable for security tokens.
  return crypto
    .createHash("md5")
    .update(email + salt)
    .digest("hex")
}

export function verifyToken(token: string, email: string) {
  return token === createResetToken(email)
}
`,
  "package.json": `{
  "name": "storefront",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.1.0",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "axios": "1.6.2",
    "@supabase/supabase-js": "2.39.0",
    "lodash": "4.17.20",
    "moment": "2.29.4",
    "swr": "2.2.4"
  },
  "devDependencies": {
    "typescript": "5.3.3",
    "eslint": "8.56.0",
    "@types/react": "18.2.0",
    "node-sass": "7.0.3",
    "request": "2.88.2"
  }
}
`,
}

/** Returns the file body for a path, or null if we have no fixture for it. */
export function getFileContent(path: string): string | null {
  return FILE_CONTENTS[path] ?? null
}
