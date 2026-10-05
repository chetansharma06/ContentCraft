import type { ReactElement, ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixTabs from '@radix-ui/react-tabs'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as RadixToast from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { Button } from './button'

export function Dialog({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  trigger?: ReactElement
  title: string
  description?: string
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay" />
        <RadixDialog.Content className="ui-dialog-content">
          <div className="ui-dialog-heading">
            <div>
              <RadixDialog.Title className="ui-dialog-title">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="ui-dialog-description">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close dialog"><X size={17} /></Button></RadixDialog.Close>
          </div>
          <div className="ui-dialog-body">{children}</div>
          <div className="ui-dialog-footer"><RadixDialog.Close asChild><Button variant="secondary">Close</Button></RadixDialog.Close></div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay" />
        <RadixDialog.Content className="ui-dialog-content ui-drawer-content">
          <div className="ui-dialog-heading">
            <div>
              <RadixDialog.Title className="ui-dialog-title">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="ui-dialog-description">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close version history"><X size={17} /></Button></RadixDialog.Close>
          </div>
          <div className="ui-dialog-body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export type TabItem = { value: string; label: string; content: ReactNode }

export function Tabs({ label, items, defaultValue }: { label: string; items: TabItem[]; defaultValue?: string }) {
  return (
    <RadixTabs.Root className="ui-tabs" defaultValue={defaultValue ?? items[0]?.value}>
      <RadixTabs.List className="ui-tabs-list" aria-label={label}>
        {items.map((item) => <RadixTabs.Trigger className="ui-tab-trigger" key={item.value} value={item.value}>{item.label}</RadixTabs.Trigger>)}
      </RadixTabs.List>
      {items.map((item) => <RadixTabs.Content className="ui-tab-panel" key={item.value} value={item.value}>{item.content}</RadixTabs.Content>)}
    </RadixTabs.Root>
  )
}

export function Tooltip({ children, content, side = 'top' }: { children: ReactElement; content: string; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <RadixTooltip.Provider delayDuration={250}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="ui-tooltip-content" side={side} sideOffset={6}>
            {content}<RadixTooltip.Arrow className="ui-tooltip-arrow" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

export function Toast({
  open,
  onOpenChange,
  title,
  description,
  tone = 'success',
  action,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  tone?: 'success' | 'error'
  action?: { label: string; altText: string; onAction: () => void }
}) {
  return (
    <RadixToast.Provider swipeDirection="right" duration={4500}>
      <RadixToast.Root className={`ui-toast ui-toast-${tone}`} open={open} onOpenChange={onOpenChange}>
        <div className="ui-toast-copy">
          <RadixToast.Title className="ui-toast-title">{title}</RadixToast.Title>
          <RadixToast.Description className="ui-toast-description">{description}</RadixToast.Description>
        </div>
        {action && <RadixToast.Action className="ui-toast-action" altText={action.altText} onClick={action.onAction}>{action.label}</RadixToast.Action>}
        <RadixToast.Close className="ui-toast-close" aria-label="Dismiss notification"><X size={16} /></RadixToast.Close>
      </RadixToast.Root>
      <RadixToast.Viewport className="ui-toast-viewport" aria-label="Notifications" />
    </RadixToast.Provider>
  )
}