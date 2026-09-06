import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex w-full flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-5xl text-center">
        <h1 className="text-6xl font-semibold tracking-tight text-emerald-300 sm:text-8xl">
          BroGram
        </h1>
        <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
          Learn by writing code, graded where you write it.
        </p>
        <Link href="/login" className={`${buttonVariants({ variant: "default" })} mt-8 h-10 bg-emerald-200 px-6 text-primary-foreground hover:bg-emerald-100`}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
