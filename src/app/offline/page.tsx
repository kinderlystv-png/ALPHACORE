export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-zinc-950 px-6 py-10 text-zinc-50">
      <section className="w-full max-w-lg rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-8 text-center shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-50 text-2xl font-bold text-zinc-950">
          A
        </div>
        <h1 className="mt-6 text-3xl font-semibold">Нет подключения</h1>
        <p className="mt-4 text-sm leading-7 text-zinc-400 sm:text-base">
          ALPHACORE открыл offline-экран. Проверь интернет и вернись, когда сеть
          снова появится.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          Попробовать снова
        </a>
      </section>
    </main>
  );
}
