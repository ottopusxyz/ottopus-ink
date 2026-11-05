import { Component, type ReactNode } from 'react'
import { Otto } from '@/components/brand/otto'
import { ErrorState } from '@/components/ui'

/**
 * What shows if drawing the app throws, instead of a blank window. It asks for a
 * restart rather than offering a reload, because a reload loses the chats in this
 * window while their agents keep running in the main process.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error('The window crashed', error)
  }

  override render() {
    if (!this.state.crashed) return this.props.children
    return (
      <main className="grid h-full place-items-center">
        <ErrorState
          title="This window stopped working"
          description="Close Ink and open it again. This window can't sign anything, and your keys are kept apart from it."
          illustration={<Otto pose="ink" size={150} />}
        />
      </main>
    )
  }
}
