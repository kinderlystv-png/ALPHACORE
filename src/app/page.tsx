export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">ALPHACORE</h1>
        <p className="text-zinc-400 text-lg">Персональный помощник-секретарь</p>
        <div className="flex gap-3 justify-center text-sm text-zinc-500">
          <span>PWA</span>
          <span>·</span>
          <span>Next.js</span>
          <span>·</span>
          <span>YC PostgreSQL</span>
        </div>
      </div>
    </div>
  );
}
