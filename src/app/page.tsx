import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex w-full flex-1 items-center justify-center px-6 py-16">
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 text-center">
        <h1 className="font-display text-hero-lg text-foreground">
          BroGram<span className="text-primary">.</span>
        </h1>
        <p className="text-lede text-muted-foreground">Learn by writing code, graded where you write it.</p>
        <Link href="/login" className={buttonVariants({ variant: "default", size: "lg" })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
