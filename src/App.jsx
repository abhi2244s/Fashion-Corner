import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const emptyProduct = { name: '', category: '', sku: '', cost_price: '', selling_price: '', quantity: '' }
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const formatMoney = (value) => money.format(Number(value) || 0)
const metrics = (product) => {
  const cost = Number(product.cost_price) || 0
  const selling = Number(product.selling_price) || 0
  const quantity = Number(product.quantity) || 0
  const profit = selling - cost
  return { profit, margin: selling ? (profit / selling) * 100 : 0, markup: cost ? (profit / cost) * 100 : 0, value: cost * quantity, potential: profit * quantity }
}

function App() {
  const [session, setSession] = useState(null)
  const [products, setProducts] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [authMode, setAuthMode] = useState('signin')
  const [auth, setAuth] = useState({ email: '', password: '' })
  const [authMessage, setAuthMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeView, setActiveView] = useState('inventory')
  const [sort, setSort] = useState('created_at')
  const [form, setForm] = useState(emptyProduct)
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saleOpen, setSaleOpen] = useState(false)
  const [saleForm, setSaleForm] = useState({ product_id: '', quantity: '1', amounts: [''], sold_at: new Date().toISOString().slice(0, 10) })
  const [editingSale, setEditingSale] = useState(null)
  const [deleteSaleTarget, setDeleteSaleTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deletingSale, setDeletingSale] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const notify = (message, type = 'success') => {
    setToast({ message, type })
    window.setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (session) loadProducts() }, [session])

  async function loadProducts() {
    setLoading(true)
    const [productResult, salesResult] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('sales').select('*, product:products(name, category)').order('sold_at', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (productResult.error) notify(productResult.error.message, 'error')
    else setProducts(productResult.data ?? [])
    if (salesResult.error) notify(`Sales setup: ${salesResult.error.message}`, 'error')
    else setSales(salesResult.data ?? [])
    setLoading(false)
  }

  async function handleAuth(event) {
    event.preventDefault()
    setAuthMessage(null)
    setSubmitting(true)
    const action = authMode === 'signin'
      ? supabase.auth.signInWithPassword(auth)
      : supabase.auth.signUp(auth)
    const { data, error } = await action
    setSubmitting(false)
    if (error) {
      setAuthMessage({ type: 'error', text: error.message })
      return notify(error.message, 'error')
    }
    const text = authMode === 'signup' && !data.session
      ? 'Account created. Check your email to confirm your account, then sign in.'
      : authMode === 'signin' ? 'Welcome back.' : 'Account created successfully.'
    setAuthMessage({ type: 'success', text })
    notify(text)
  }

  const openCreate = () => { setEditing(null); setForm(emptyProduct); setFormOpen(true) }
  const openEdit = (product) => { setEditing(product); setForm({ ...product }); setFormOpen(true) }
  const openSale = () => { const product = products.find((p) => p.quantity > 0); setEditingSale(null); setSaleForm({ product_id: product?.id ?? '', quantity: '1', amounts: product ? [String(product.selling_price)] : [''], sold_at: new Date().toISOString().slice(0, 10) }); setSaleOpen(true) }
  const openSaleEdit = (sale) => { setEditingSale(sale); setSaleForm({ product_id: sale.product_id ?? '', quantity: String(sale.quantity), amounts: sale.unit_prices?.length ? sale.unit_prices.map(String) : Array.from({ length: sale.quantity }, () => String(sale.unit_price)), sold_at: sale.sold_at }); setSaleOpen(true) }

  async function saveProduct(event) {
    event.preventDefault()
    setSubmitting(true)
    const payload = {
      name: form.name.trim(), category: form.category.trim() || 'Uncategorized', sku: form.sku.trim() || null,
      cost_price: Number(form.cost_price), selling_price: Number(form.selling_price), quantity: Number(form.quantity),
    }
    if (!payload.name || !Number.isFinite(payload.cost_price) || !Number.isFinite(payload.selling_price) || !Number.isInteger(payload.quantity) || payload.quantity < 0) {
      setSubmitting(false)
      return notify('Enter a name, valid prices, and a whole-number quantity.', 'error')
    }
    const request = editing
      ? supabase.from('products').update(payload).eq('id', editing.id)
      : supabase.from('products').insert({ ...payload, user_id: session.user.id })
    const { error } = await request
    setSubmitting(false)
    if (error) return notify(error.message, 'error')
    notify(editing ? 'Product updated.' : 'Product added.')
    setFormOpen(false)
    loadProducts()
  }

  async function deleteProduct() {
    setDeleting(true)
    const { error } = await supabase.from('products').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) notify(error.message, 'error')
    else { notify('Product deleted.'); loadProducts() }
    setDeleteTarget(null)
  }

  async function recordSale(event) {
    event.preventDefault()
    setSubmitting(true)
    const quantity = Number(saleForm.quantity)
    const amounts = saleForm.amounts.map(Number)
    if (!saleForm.product_id || !Number.isInteger(quantity) || quantity <= 0 || amounts.length !== quantity || amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
      setSubmitting(false)
      return notify('Choose a product and enter one valid amount for every unit.', 'error')
    }
    const { error } = editingSale
      ? await supabase.rpc('update_sale_with_prices', { p_sale_id: editingSale.id, p_product_id: saleForm.product_id, p_unit_prices: amounts, p_sold_at: saleForm.sold_at })
      : await supabase.rpc('record_sale_with_prices', { p_product_id: saleForm.product_id, p_unit_prices: amounts, p_sold_at: saleForm.sold_at })
    setSubmitting(false)
    if (error) return notify(error.message, 'error')
    notify(editingSale ? 'Daily sale updated.' : 'Sale recorded and stock updated.')
    setSaleOpen(false)
    setEditingSale(null)
    loadProducts()
  }

  async function deleteSale() {
    setDeletingSale(true)
    const { error } = await supabase.rpc('delete_sale', { p_sale_id: deleteSaleTarget.id })
    setDeletingSale(false)
    if (error) notify(error.message, 'error')
    else { notify('Daily sale deleted and stock restored.'); loadProducts() }
    setDeleteSaleTarget(null)
  }

  async function handleSignOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    setSigningOut(false)
    if (error) notify(error.message, 'error')
  }

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products])
  const displayed = useMemo(() => products.filter((p) => {
    const matchesQuery = `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (category === 'all' || p.category === category) && (activeCategory === 'all' || p.category.toLowerCase() === activeCategory.toLowerCase())
  }).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'margin') return metrics(b).margin - metrics(a).margin
    if (sort === 'profit') return metrics(b).potential - metrics(a).potential
    return new Date(b.created_at) - new Date(a.created_at)
  }), [products, query, category, activeCategory, sort])
  const summary = useMemo(() => products.reduce((total, item) => {
    const stat = metrics(item)
    total.value += stat.value; total.potential += stat.potential; total.margin += stat.margin
    return total
  }, { value: 0, potential: 0, margin: 0 }), [products])
  const today = new Date().toISOString().slice(0, 10)
  const daily = useMemo(() => sales.filter((sale) => sale.sold_at === today).reduce((total, sale) => {
    const prices = sale.unit_prices?.length ? sale.unit_prices.map(Number) : Array.from({ length: Number(sale.quantity) }, () => Number(sale.unit_price))
    total.items += Number(sale.quantity); total.revenue += prices.reduce((sum, price) => sum + price, 0); total.profit += prices.reduce((sum, price) => sum + price - Number(sale.unit_cost), 0); return total
  }, { items: 0, revenue: 0, profit: 0 }), [sales, today])

  if (!isSupabaseConfigured) return <SetupNotice />
  if (loading && !session) return <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">Loading Fashion Corner…</div>
  if (!session) return <AuthScreen auth={auth} setAuth={setAuth} authMode={authMode} setAuthMode={setAuthMode} message={authMessage} submit={handleAuth} submitting={submitting} />

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white lg:pl-64"><div className="mx-auto flex max-w-none items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div><p className="text-xs font-bold tracking-[.18em] text-rose-600 uppercase">Fashion Corner</p><h1 className="text-xl font-bold">Inventory & Margin Tracker</h1></div>
        <div className="flex items-center gap-3"><span className="hidden text-sm text-slate-500 sm:inline">{session.user.email}</span><button disabled={signingOut} onClick={handleSignOut} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950 disabled:opacity-60">{signingOut && <Spinner />} {signingOut ? 'Signing out…' : 'Sign out'}</button></div>
      </div></header>
      <div className="flex flex-col gap-6 px-4 py-7 sm:px-6 lg:block lg:pl-64 lg:pr-8">
        <aside className="shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-60 lg:border-r lg:border-slate-200 lg:bg-white lg:pt-20"><div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:min-h-full lg:rounded-none lg:border-0 lg:shadow-none"><p className="px-3 pb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">Dashboard</p><button onClick={() => setActiveView('inventory')} className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium ${activeView === 'inventory' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><span>Inventory</span><span className="text-xs opacity-75">{products.length}</span></button><button onClick={() => setActiveView('sales')} className={`mb-4 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium ${activeView === 'sales' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><span>Daily sales</span><span className="text-xs opacity-75">{daily.items}</span></button><p className="border-t border-slate-100 px-3 pt-4 pb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">Categories</p>{['all', 'Shirts', 'T-shirts', 'Jeans', 'Shoes'].map((item) => <button key={item} onClick={() => { setActiveView('inventory'); setActiveCategory(item); setCategory('all') }} className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium ${activeView === 'inventory' && activeCategory === item ? 'bg-rose-50 text-rose-700' : 'text-slate-600 hover:bg-slate-100'}`}><span>{item === 'all' ? 'All products' : item}</span><span className="text-xs opacity-75">{item === 'all' ? products.length : products.filter((p) => p.category.toLowerCase() === item.toLowerCase()).length}</span></button>)}</div></aside>
        <main className="min-w-0 flex-1 lg:mx-auto lg:max-w-none">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-bold tracking-tight">{activeView === 'sales' ? 'Daily sales dashboard' : activeCategory === 'all' ? 'Inventory dashboard' : activeCategory}</h2><p className="mt-1 text-sm text-slate-500">{activeView === 'sales' ? 'Track every sale, today’s revenue, and profit.' : 'Manage your stock, categories, and product margins.'}</p></div><div className="flex gap-2">{activeView === 'sales' ? <button onClick={openSale} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">+ Record sale</button> : <button onClick={openCreate} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700">+ Add product</button>}</div></div>
        {activeView === 'sales' ? <ReadableSalesDashboard daily={daily} sales={sales} today={today} onEdit={openSaleEdit} onDelete={setDeleteSaleTarget} /> : <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total products" value={products.length} hint="Unique items in your catalog" />
          <Stat label="Inventory value" value={formatMoney(summary.value)} hint="At cost price" />
          <Stat label="Potential profit" value={formatMoney(summary.potential)} hint="If all units sell" accent />
          <Stat label="Average margin" value={`${products.length ? (summary.margin / products.length).toFixed(1) : 0}%`} hint="Average across products" />
        </section>
        <section className="mt-7 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="font-semibold">Products <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{displayed.length}</span></h2>
            <div className="flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or SKU…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500 sm:w-52" />
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500"><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500"><option value="created_at">Newest first</option><option value="name">Name A–Z</option><option value="margin">Highest margin</option><option value="profit">Highest profit</option></select>
            </div>
          </div>
          <ProductTable products={displayed} loading={loading} onEdit={openEdit} onDelete={setDeleteTarget} />
        </section></>}
        </main>
      </div>
      {formOpen && <ProductForm form={form} setForm={setForm} editing={editing} onClose={() => setFormOpen(false)} onSubmit={saveProduct} submitting={submitting} />}
      {saleOpen && <FlexibleSaleForm products={products} form={saleForm} setForm={setSaleForm} editing={editingSale} onClose={() => { setSaleOpen(false); setEditingSale(null) }} onSubmit={recordSale} submitting={submitting} />}
      {deleteTarget && <ConfirmDelete product={deleteTarget} deleting={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={deleteProduct} />}
      {deleteSaleTarget && <ConfirmSaleDelete sale={deleteSaleTarget} deleting={deletingSale} onCancel={() => setDeleteSaleTarget(null)} onConfirm={deleteSale} />}
      {toast && <div className={`fixed right-4 bottom-4 z-50 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : 'bg-slate-900'}`}>{toast.message}</div>}
    </div>
  )
}

function SetupNotice() { return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><section className="max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm"><p className="text-sm font-bold tracking-widest text-rose-600 uppercase">Fashion Corner</p><h1 className="mt-2 text-2xl font-bold">Connect Supabase to begin</h1><p className="mt-3 text-slate-600">Copy <code className="rounded bg-slate-100 px-1.5 py-0.5">.env.example</code> to <code className="rounded bg-slate-100 px-1.5 py-0.5">.env</code>, add your Project URL and anon key, then run the SQL migration in Supabase.</p></section></main> }
function AuthScreen({ auth, setAuth, authMode, setAuthMode, message, submit, submitting }) { const signup = authMode === 'signup'; return <main className="grid min-h-screen place-items-center bg-slate-50 p-4"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9"><p className="text-sm font-bold tracking-[.18em] text-rose-600 uppercase">Fashion Corner</p><h1 className="mt-2 text-2xl font-bold">{signup ? 'Create your account' : 'Welcome back'}</h1><p className="mt-2 text-sm text-slate-500">{signup ? 'Start tracking your product margins today.' : 'Sign in to your private inventory.'}</p><form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-sm font-medium">Email<input required type="email" value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-rose-500" /></label><label className="block text-sm font-medium">Password<input required minLength="6" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-rose-500" /></label><button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{submitting && <Spinner />}{submitting ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button></form>{message && <p role="status" className={`mt-4 rounded-lg px-3 py-2 text-sm ${message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{message.text}</p>}<button onClick={() => setAuthMode(signup ? 'signin' : 'signup')} className="mt-5 text-sm font-medium text-rose-700 hover:underline">{signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></section></main> }
function Stat({ label, value, hint, accent }) { return <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-slate-500">{label}</p><p className={`mt-2 text-2xl font-bold ${accent ? 'text-emerald-600' : ''}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{hint}</p></article> }
function SalesDashboard({ daily, sales, today }) { const todaySales = sales.filter((sale) => sale.sold_at === today); return <><section className="grid gap-4 sm:grid-cols-3"><Stat label="Items sold today" value={daily.items} hint="Units sold" /><Stat label="Sales today" value={formatMoney(daily.revenue)} hint="Selling value" /><Stat label="Profit today" value={formatMoney(daily.profit)} hint="After cost price" accent /></section><section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Today’s sale record</h2><p className="mt-1 text-sm text-slate-500">Every recorded sale reduces the matching product’s stock.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"><tr>{['Product', 'Category', 'Units', 'Sales value', 'Profit', 'Date'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{todaySales.length === 0 ? <tr><td colSpan="6" className="px-4 py-12 text-center text-slate-500">No sales recorded today. Click “Record sale” to add one.</td></tr> : todaySales.map((sale) => <tr key={sale.id}><td className="px-4 py-3 font-medium">{sale.product?.name ?? 'Deleted product'}</td><td className="px-4 py-3 text-slate-600">{sale.product?.category ?? '—'}</td><td className="px-4 py-3">{sale.quantity}</td><td className="px-4 py-3">{formatMoney(Number(sale.unit_price) * Number(sale.quantity))}</td><td className="px-4 py-3 font-medium text-emerald-600">{formatMoney((Number(sale.unit_price) - Number(sale.unit_cost)) * Number(sale.quantity))}</td><td className="px-4 py-3 text-slate-600">{sale.sold_at}</td></tr>)}</tbody></table></div></section></> }
function ProductTable({ products, loading, onEdit, onDelete }) { return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"><tr>{['Name', 'Category', 'Cost price', 'Selling price', 'Profit / unit', 'Margin', 'Quantity', 'Actions'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan="8" className="px-4 py-10 text-center text-slate-500">Loading products…</td></tr> : products.length === 0 ? <tr><td colSpan="8" className="px-4 py-12 text-center text-slate-500">No products found. Add your first product to start tracking profits.</td></tr> : products.map((p) => { const m = metrics(p); const low = m.margin < 10; return <tr key={p.id} className="hover:bg-slate-50"><td className="px-4 py-3"><p className="font-semibold text-slate-800">{p.name}</p>{p.sku && <p className="mt-0.5 text-xs text-slate-400">SKU: {p.sku}</p>}</td><td className="px-4 py-3 text-slate-600">{p.category}</td><td className="px-4 py-3">{formatMoney(p.cost_price)}</td><td className="px-4 py-3">{formatMoney(p.selling_price)}</td><td className={`px-4 py-3 font-medium ${m.profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatMoney(m.profit)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${low ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{m.margin.toFixed(1)}%</span></td><td className="px-4 py-3">{p.quantity}</td><td className="px-4 py-3 whitespace-nowrap"><button onClick={() => onEdit(p)} className="mr-3 font-medium text-slate-700 hover:text-rose-700">Edit</button><button onClick={() => onDelete(p)} className="font-medium text-red-600 hover:text-red-800">Delete</button></td></tr> })}</tbody></table></div> }
function ProductForm({ form, setForm, editing, onClose, onSubmit, submitting }) { const change = (e) => setForm({ ...form, [e.target.name]: e.target.value }); const preview = metrics(form); return <Dialog><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{editing ? 'Edit product' : 'Add product'}</h2><button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-800">×</button></div><form onSubmit={onSubmit} className="mt-5 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Product name" name="name" value={form.name} onChange={change} required /><Field label="Category" name="category" value={form.category} onChange={change} placeholder="e.g. Dresses" /><Field label="SKU (optional)" name="sku" value={form.sku || ''} onChange={change} /><Field label="Quantity" name="quantity" type="number" min="0" value={form.quantity} onChange={change} required /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Cost price" name="cost_price" type="number" min="0" step="0.01" value={form.cost_price} onChange={change} required /><Field label="Selling price" name="selling_price" type="number" min="0" step="0.01" value={form.selling_price} onChange={change} required /></div><div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs"><div><p className="text-slate-500">Profit/unit</p><b>{formatMoney(preview.profit)}</b></div><div><p className="text-slate-500">Margin</p><b className={preview.margin < 10 ? 'text-red-600' : 'text-emerald-600'}>{preview.margin.toFixed(1)}%</b></div><div><p className="text-slate-500">Markup</p><b>{preview.markup.toFixed(1)}%</b></div></div><div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{submitting && <Spinner />}{submitting ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button></div></form></Dialog> }
function SaleForm({ products, form, setForm, onClose, onSubmit, submitting }) { const selected = products.find((p) => p.id === form.product_id); const saleTotal = selected ? Number(selected.selling_price) * Number(form.quantity || 0) : 0; const saleProfit = selected ? (Number(selected.selling_price) - Number(selected.cost_price)) * Number(form.quantity || 0) : 0; return <Dialog><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Record daily sale</h2><p className="mt-1 text-sm text-slate-500">Stock will be reduced after saving.</p></div><button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-800">×</button></div><form onSubmit={onSubmit} className="mt-5 space-y-4"><label className="block text-sm font-medium text-slate-700">Product<select required value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"><option value="">Choose a product</option>{products.filter((p) => p.quantity > 0).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category} · {p.quantity} in stock</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><Field label="Units sold" name="quantity" type="number" min="1" max={selected?.quantity} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /><Field label="Sale date" name="sold_at" type="date" value={form.sold_at} onChange={(e) => setForm({ ...form, sold_at: e.target.value })} required /></div>{selected && <div className="grid grid-cols-3 gap-2 rounded-lg bg-emerald-50 p-3 text-center text-xs"><div><p className="text-emerald-700">Selling total</p><b>{formatMoney(saleTotal)}</b></div><div><p className="text-emerald-700">Profit</p><b>{formatMoney(saleProfit)}</b></div><div><p className="text-emerald-700">Stock after</p><b>{Math.max(0, selected.quantity - Number(form.quantity || 0))}</b></div></div>}<div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submitting || !selected} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{submitting && <Spinner />}{submitting ? 'Recording…' : 'Record sale'}</button></div></form></Dialog> }
function Field({ label, ...props }) { return <label className="block text-sm font-medium text-slate-700">{label}<input {...props} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-rose-500" /></label> }
function ConfirmDelete({ product, onCancel, onConfirm, deleting }) { return <Dialog><h2 className="text-lg font-bold">Delete product?</h2><p className="mt-2 text-sm text-slate-600">This will permanently delete <b>{product.name}</b>. This action cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button disabled={deleting} onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60">Cancel</button><button disabled={deleting} onClick={onConfirm} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{deleting && <Spinner />}{deleting ? 'Deleting…' : 'Delete product'}</button></div></Dialog> }
function Dialog({ children }) { return <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">{children}</div></div> }
function Spinner() { return <span aria-label="Loading" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> }

function EditableSalesDashboard({ daily, sales, today, onEdit, onDelete }) {
  const todaySales = sales.filter((sale) => sale.sold_at === today)
  return <><section className="grid gap-4 sm:grid-cols-3"><Stat label="Items sold today" value={daily.items} hint="Units sold" /><Stat label="Sales today" value={formatMoney(daily.revenue)} hint="Selling value" /><Stat label="Profit today" value={formatMoney(daily.profit)} hint="After cost price" accent /></section><section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Today’s sale record</h2><p className="mt-1 text-sm text-slate-500">Edit the amount, quantity, or date, or remove a record to restore its stock.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"><tr>{['Product', 'Category', 'Units', 'Amount / unit', 'Sales value', 'Profit', 'Date', 'Actions'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{todaySales.length === 0 ? <tr><td colSpan="8" className="px-4 py-12 text-center text-slate-500">No sales recorded today. Click “Record sale” to add one.</td></tr> : todaySales.map((sale) => <tr key={sale.id}><td className="px-4 py-3 font-medium">{sale.product?.name ?? 'Deleted product'}</td><td className="px-4 py-3 text-slate-600">{sale.product?.category ?? '—'}</td><td className="px-4 py-3">{sale.quantity}</td><td className="px-4 py-3">{formatMoney(sale.unit_price)}</td><td className="px-4 py-3">{formatMoney(Number(sale.unit_price) * Number(sale.quantity))}</td><td className="px-4 py-3 font-medium text-emerald-600">{formatMoney((Number(sale.unit_price) - Number(sale.unit_cost)) * Number(sale.quantity))}</td><td className="px-4 py-3 text-slate-600">{sale.sold_at}</td><td className="px-4 py-3 whitespace-nowrap"><button onClick={() => onEdit(sale)} className="mr-3 font-medium text-slate-700 hover:text-emerald-700">Edit</button><button onClick={() => onDelete(sale)} className="font-medium text-red-600 hover:text-red-800">Delete</button></td></tr>)}</tbody></table></div></section></>
}

function EditableSaleForm({ products, form, setForm, editing, onClose, onSubmit, submitting }) {
  const selected = products.find((p) => p.id === form.product_id)
  const saleTotal = Number(form.amount || 0) * Number(form.quantity || 0)
  const saleProfit = selected ? (Number(form.amount || 0) - Number(selected.cost_price)) * Number(form.quantity || 0) : 0
  return <Dialog><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">{editing ? 'Edit daily sale' : 'Record daily sale'}</h2><p className="mt-1 text-sm text-slate-500">Enter the actual amount received per unit.</p></div><button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-800">×</button></div><form onSubmit={onSubmit} className="mt-5 space-y-4"><label className="block text-sm font-medium text-slate-700">Product<select required disabled={Boolean(editing)} value={form.product_id} onChange={(e) => { const product = products.find((item) => item.id === e.target.value); setForm({ ...form, product_id: e.target.value, amount: product?.selling_price ?? '' }) }} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500 disabled:bg-slate-100"><option value="">Choose a product</option>{products.filter((p) => p.quantity > 0 || p.id === editing?.product_id).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category} · {p.quantity} in stock</option>)}</select></label><div className="grid gap-4 sm:grid-cols-3"><Field label="Units sold" name="quantity" type="number" min="1" max={editing ? undefined : selected?.quantity} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /><Field label="Amount per unit" name="amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /><Field label="Sale date" name="sold_at" type="date" value={form.sold_at} onChange={(e) => setForm({ ...form, sold_at: e.target.value })} required /></div>{selected && <div className="grid grid-cols-3 gap-2 rounded-lg bg-emerald-50 p-3 text-center text-xs"><div><p className="text-emerald-700">Selling total</p><b>{formatMoney(saleTotal)}</b></div><div><p className="text-emerald-700">Profit</p><b>{formatMoney(saleProfit)}</b></div><div><p className="text-emerald-700">Stock after</p><b>{editing ? 'Recalculated' : Math.max(0, selected.quantity - Number(form.quantity || 0))}</b></div></div>}<div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submitting || !selected} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{submitting && <Spinner />}{submitting ? 'Saving…' : editing ? 'Save changes' : 'Record sale'}</button></div></form></Dialog>
}

function ConfirmSaleDelete({ sale, onCancel, onConfirm, deleting }) { return <Dialog><h2 className="text-lg font-bold">Delete daily sale?</h2><p className="mt-2 text-sm text-slate-600">This removes the sale and returns its units to stock.</p><div className="mt-6 flex justify-end gap-3"><button disabled={deleting} onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-60">Cancel</button><button disabled={deleting} onClick={onConfirm} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">{deleting && <Spinner />}{deleting ? 'Deleting…' : 'Delete sale'}</button></div></Dialog> }

function salePrices(sale) { return sale.unit_prices?.length ? sale.unit_prices.map(Number) : Array.from({ length: Number(sale.quantity) }, () => Number(sale.unit_price)) }
function FlexibleSalesDashboard({ daily, sales, today, onEdit, onDelete }) {
  const todaySales = sales.filter((sale) => sale.sold_at === today)
  return <><section className="grid gap-4 sm:grid-cols-3"><Stat label="Items sold today" value={daily.items} hint="Units sold" /><Stat label="Sales today" value={formatMoney(daily.revenue)} hint="Selling value" /><Stat label="Profit today" value={formatMoney(daily.profit)} hint="After cost price" accent /></section><section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Today’s sale record</h2><p className="mt-1 text-sm text-slate-500">Each unit can have its own selling amount.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"><tr>{['Product', 'Category', 'Units', 'Unit amounts', 'Sales value', 'Profit', 'Date', 'Actions'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{todaySales.length === 0 ? <tr><td colSpan="8" className="px-4 py-12 text-center text-slate-500">No sales recorded today. Click “Record sale” to add one.</td></tr> : todaySales.map((sale) => { const prices = salePrices(sale); const total = prices.reduce((sum, price) => sum + price, 0); const profit = prices.reduce((sum, price) => sum + price - Number(sale.unit_cost), 0); return <tr key={sale.id}><td className="px-4 py-3 font-medium">{sale.product?.name ?? 'Deleted product'}</td><td className="px-4 py-3 text-slate-600">{sale.product?.category ?? '—'}</td><td className="px-4 py-3">{sale.quantity}</td><td className="px-4 py-3">{prices.map(formatMoney).join(' + ')}</td><td className="px-4 py-3">{formatMoney(total)}</td><td className="px-4 py-3 font-medium text-emerald-600">{formatMoney(profit)}</td><td className="px-4 py-3 text-slate-600">{sale.sold_at}</td><td className="px-4 py-3 whitespace-nowrap"><button onClick={() => onEdit(sale)} className="mr-3 font-medium text-slate-700 hover:text-emerald-700">Edit</button><button onClick={() => onDelete(sale)} className="font-medium text-red-600 hover:text-red-800">Delete</button></td></tr> })}</tbody></table></div></section></>
}

function FlexibleSaleForm({ products, form, setForm, editing, onClose, onSubmit, submitting }) {
  const selected = products.find((p) => p.id === form.product_id)
  const quantity = Math.max(1, Number(form.quantity) || 1)
  const amounts = Array.from({ length: quantity }, (_, index) => form.amounts[index] ?? selected?.selling_price ?? '')
  const total = amounts.reduce((sum, amount) => sum + (Number(amount) || 0), 0)
  const profit = selected ? amounts.reduce((sum, amount) => sum + (Number(amount) || 0) - Number(selected.cost_price), 0) : 0
  const setQuantity = (value) => { const next = Math.max(1, Number(value) || 1); setForm({ ...form, quantity: value, amounts: Array.from({ length: next }, (_, index) => form.amounts[index] ?? selected?.selling_price ?? '') }) }
  return <Dialog><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">{editing ? 'Edit daily sale' : 'Record daily sale'}</h2><p className="mt-1 text-sm text-slate-500">Enter a separate amount for each unit sold.</p></div><button onClick={onClose} className="text-xl text-slate-400 hover:text-slate-800">×</button></div><form onSubmit={onSubmit} className="mt-5 space-y-4"><label className="block text-sm font-medium text-slate-700">Product<select required disabled={Boolean(editing)} value={form.product_id} onChange={(e) => { const product = products.find((item) => item.id === e.target.value); setForm({ ...form, product_id: e.target.value, amounts: Array.from({ length: quantity }, () => product?.selling_price ?? '') }) }} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500 disabled:bg-slate-100"><option value="">Choose a product</option>{products.filter((p) => p.quantity > 0 || p.id === editing?.product_id).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.category} · {p.quantity} in stock</option>)}</select></label><Field label="Units sold" name="quantity" type="number" min="1" max={editing ? undefined : selected?.quantity} value={form.quantity} onChange={(e) => setQuantity(e.target.value)} required />{selected && <div className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Selling amount for each unit</p>{amounts.map((amount, index) => <Field key={index} label={`Unit ${index + 1}`} type="number" min="0" step="0.01" value={amount} onChange={(e) => setForm({ ...form, amounts: form.amounts.map((current, amountIndex) => amountIndex === index ? e.target.value : current) })} required />)}</div>}<Field label="Sale date" name="sold_at" type="date" value={form.sold_at} onChange={(e) => setForm({ ...form, sold_at: e.target.value })} required />{selected && <div className="grid grid-cols-2 gap-2 rounded-lg bg-emerald-50 p-3 text-center text-xs"><div><p className="text-emerald-700">Sales total</p><b>{formatMoney(total)}</b></div><div><p className="text-emerald-700">Profit</p><b>{formatMoney(profit)}</b></div></div>}<div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submitting || !selected} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{submitting && <Spinner />}{submitting ? 'Saving…' : editing ? 'Save changes' : 'Record sale'}</button></div></form></Dialog>
}

function ReadableSalesDashboard({ daily, sales, today, onEdit, onDelete }) {
  const todaySales = sales.filter((sale) => sale.sold_at === today)
  return <><section className="grid gap-4 sm:grid-cols-3"><Stat label="Items sold today" value={daily.items} hint="Units sold" /><Stat label="Sales today" value={formatMoney(daily.revenue)} hint="Selling value" /><Stat label="Profit today" value={formatMoney(daily.profit)} hint="After cost price" accent /></section><section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><h2 className="font-semibold">Today’s sale record</h2><p className="mt-1 text-sm text-slate-500">Each amount is shown against its unit number.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"><tr>{['Product', 'Category', 'Units', 'Unit amounts', 'Sales value', 'Profit', 'Date', 'Actions'].map((head) => <th key={head} className="px-4 py-3 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{todaySales.length === 0 ? <tr><td colSpan="8" className="px-4 py-12 text-center text-slate-500">No sales recorded today. Click “Record sale” to add one.</td></tr> : todaySales.map((sale) => { const prices = salePrices(sale); const total = prices.reduce((sum, price) => sum + price, 0); const profit = prices.reduce((sum, price) => sum + price - Number(sale.unit_cost), 0); return <tr key={sale.id} className="align-top"><td className="px-4 py-3 font-medium">{sale.product?.name ?? 'Deleted product'}</td><td className="px-4 py-3 text-slate-600">{sale.product?.category ?? '—'}</td><td className="px-4 py-3 font-semibold">{sale.quantity}</td><td className="px-4 py-3"><div className="max-h-20 min-w-[180px] overflow-y-auto pr-1"><div className="grid grid-cols-2 gap-1">{prices.map((price, index) => <span key={`${sale.id}-${index}`} className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800" title={`Unit ${index + 1}`}>#{index + 1} {formatMoney(price)}</span>)}</div></div></td><td className="px-4 py-3 font-medium">{formatMoney(total)}</td><td className="px-4 py-3 font-medium text-emerald-600">{formatMoney(profit)}</td><td className="px-4 py-3 text-slate-600">{sale.sold_at}</td><td className="px-4 py-3 whitespace-nowrap"><button onClick={() => onEdit(sale)} className="mr-3 font-medium text-slate-700 hover:text-emerald-700">Edit</button><button onClick={() => onDelete(sale)} className="font-medium text-red-600 hover:text-red-800">Delete</button></td></tr> })}</tbody></table></div></section></>
}

export default App
