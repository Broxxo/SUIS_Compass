import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import { cn } from "../../lib/utils"

type DialogContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog components must be used within Dialog")
  return ctx
}

function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  children?: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, openProp],
  )
  const value = React.useMemo(() => ({ open, setOpen }), [open, setOpen])
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
}

const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ asChild, children, onClick, ...props }, ref) => {
  const { setOpen } = useDialogContext()
  const openDialog = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented) setOpen(true)
  }
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        child.props.onClick?.(event)
        if (!event.defaultPrevented) setOpen(true)
      },
    })
  }
  return (
    <button ref={ref} type="button" onClick={openDialog} {...props}>
      {children}
    </button>
  )
})
DialogTrigger.displayName = "DialogTrigger"

const DialogPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DialogOverlay = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
)
DialogOverlay.displayName = "DialogOverlay"

const DialogClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, ...props }, ref) => {
    const { setOpen } = useDialogContext()
    return (
      <button
        ref={ref}
        type="button"
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) setOpen(false)
        }}
        {...props}
      />
    )
  },
)
DialogClose.displayName = "DialogClose"

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    onOpenAutoFocus?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void
  }
>(({ className, children, onOpenAutoFocus, ...props }, ref) => {
  const { open, setOpen } = useDialogContext()
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const setPanelRef = (node: HTMLDivElement | null) => {
    panelRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (document.querySelector("[role='listbox']")) return
      setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, setOpen])

  const focusedRef = React.useRef(false)
  React.useEffect(() => {
    if (!open) {
      focusedRef.current = false
      return
    }
    if (focusedRef.current) return
    focusedRef.current = true
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    onOpenAutoFocus?.(event)
    if (!event.defaultPrevented) panelRef.current?.focus()
  }, [open, onOpenAutoFocus])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/80" onClick={() => setOpen(false)} />
      <div
        ref={setPanelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg outline-none sm:rounded-lg",
          className,
        )}
        {...props}
      >
        {children}
        <button
          type="button"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>
    </div>,
    document.body,
  )
})
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
  ),
)
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
)
DialogDescription.displayName = "DialogDescription"

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
