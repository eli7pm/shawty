import { useCallback, useEffect, useState, type FormEvent } from "react"
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Link2Icon,
  Loader2Icon,
  LogOutIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  createLink,
  deleteLink,
  getMe,
  listLinks,
  loginUrl,
  logoutUrl,
  shortUrl,
  type ShortLink,
  type User,
} from "@/lib/api"

type AuthState = { status: "loading" } | { status: "ready"; user: User | null }

const CODE_PATTERN = "[A-Za-z0-9_-]{3,32}"

function initials(user: User) {
  const source = user.name || user.email || "?"
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("")
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const seconds = Math.round((then - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return "just now"
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Couldn't copy to the clipboard")
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" onClick={copy} aria-label={label} />
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  )
}

function Header({ auth }: { auth: AuthState }) {
  return (
    <header className="flex items-center justify-between py-6">
      <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Link2Icon className="size-4" />
        </span>
        <span className="text-lg">Shawty</span>
      </a>
      {auth.status === "loading" ? (
        <Skeleton className="size-8 rounded-full" />
      ) : auth.user ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="rounded-full" />}
            aria-label="Account"
          >
            <Avatar>
              {auth.user.picture && <AvatarImage src={auth.user.picture} alt="" />}
              <AvatarFallback>{initials(auth.user)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="truncate font-medium text-foreground">
                  {auth.user.name || "Signed in"}
                </div>
                {auth.user.email && (
                  <div className="truncate text-xs font-normal">{auth.user.email}</div>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.location.assign(logoutUrl)}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <a href={loginUrl} className={buttonVariants({ variant: "outline" })}>
          Sign in
        </a>
      )}
    </header>
  )
}

function ShortenForm({ onCreated }: { onCreated: (link: ShortLink) => void }) {
  const [url, setUrl] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [latest, setLatest] = useState<ShortLink | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const link = await createLink(url.trim(), code.trim() || undefined)
      setLatest(link)
      setUrl("")
      setCode("")
      onCreated(link)
      toast.success("Link shortened")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Long URL</Label>
          <Input
            id="url"
            type="url"
            required
            inputMode="url"
            placeholder="https://example.com/a/very/long/link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="code">
              Custom code <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <span className="truncate pl-2.5 text-sm text-muted-foreground select-none">
                {window.location.host}/s/
              </span>
              <Input
                id="code"
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                placeholder="my-link"
                pattern={CODE_PATTERN}
                title="3–32 letters, numbers, dashes or underscores"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="sm:w-32">
            {busy && <Loader2Icon className="animate-spin" />}
            Shorten
          </Button>
        </div>
      </form>
      {latest && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-2 pl-3">
          <a
            href={shortUrl(latest.code)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate font-medium hover:underline"
          >
            {shortUrl(latest.code).replace(/^https?:\/\//, "")}
          </a>
          <CopyButton value={shortUrl(latest.code)} label="Copy short link" />
        </div>
      )}
    </div>
  )
}

function LinksTable({
  links,
  onDelete,
}: {
  links: ShortLink[] | null
  onDelete: (code: string) => void
}) {
  if (links === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (links.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No links yet. Shorten your first URL above.
      </p>
    )
  }
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[34%]">Short link</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead className="hidden w-28 sm:table-cell">Created</TableHead>
          <TableHead className="w-20 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {links.map((link) => (
          <TableRow key={link.code}>
            <TableCell className="truncate">
              <a
                href={shortUrl(link.code)}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                /s/{link.code}
              </a>
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 hover:text-foreground"
                title={link.url}
              >
                <span className="truncate">{link.url.replace(/^https?:\/\//, "")}</span>
                <ExternalLinkIcon className="size-3 shrink-0" />
              </a>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {relativeTime(link.created)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end">
                <CopyButton value={shortUrl(link.code)} label="Copy short link" />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete link"
                        onClick={() => onDelete(link.code)}
                      />
                    }
                  >
                    <Trash2Icon />
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" })
  const [links, setLinks] = useState<ShortLink[] | null>(null)

  useEffect(() => {
    getMe()
      .then((user) => setAuth({ status: "ready", user }))
      .catch(() => setAuth({ status: "ready", user: null }))
  }, [])

  const refresh = useCallback(() => {
    listLinks()
      .then(setLinks)
      .catch((error) => {
        setLinks([])
        toast.error(error instanceof Error ? error.message : "Couldn't load your links")
      })
  }, [])

  const signedIn = auth.status === "ready" && auth.user !== null
  useEffect(() => {
    if (signedIn) refresh()
  }, [signedIn, refresh])

  async function remove(code: string) {
    const previous = links
    setLinks((current) => current?.filter((l) => l.code !== code) ?? null)
    try {
      await deleteLink(code)
      toast.success(`Deleted /s/${code}`)
    } catch (error) {
      setLinks(previous)
      toast.error(error instanceof Error ? error.message : "Couldn't delete that link")
    }
  }

  return (
    <div className="min-h-svh bg-muted/40">
      <div className="mx-auto w-full max-w-3xl px-4">
        <Header auth={auth} />
        <main className="space-y-6 pb-16">
          <section className="space-y-2 pt-6 pb-2 text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Long links, made shawty.
            </h1>
            <p className="text-muted-foreground">
              Paste a URL, get a short link you can share anywhere.
            </p>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Shorten a link</CardTitle>
              <CardDescription>
                Short links redirect anyone who opens them. Only you see your list.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auth.status === "loading" ? (
                <Skeleton className="h-28 w-full" />
              ) : signedIn ? (
                <ShortenForm
                  onCreated={(link) =>
                    setLinks((current) => [link, ...(current ?? []).filter((l) => l.code !== link.code)])
                  }
                />
              ) : (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Sign in with Google to create short links and keep a history of them.
                  </p>
                  <a href={loginUrl} className={buttonVariants()}>
                    Sign in with Google
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {signedIn && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Your links
                  {links && links.length > 0 && (
                    <Badge variant="secondary">{links.length}</Badge>
                  )}
                </CardTitle>
                <CardDescription>Everything you've shortened, newest first.</CardDescription>
              </CardHeader>
              <CardContent>
                <LinksTable links={links} onDelete={remove} />
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  )
}
