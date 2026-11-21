import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="panel max-w-md p-8 text-center">
        <p className="hud-label text-muted-foreground">Signal lost</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">No such position</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That route is not on the map. Head back to the command console.
        </p>
        <Link
          to="/"
          className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Return to base
        </Link>
      </div>
    </div>
  );
}
