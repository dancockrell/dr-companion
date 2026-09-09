import { Eye, EyeOff, PictureInPicture2, Loader2 } from 'lucide-react'
import { PANEL_BAR_ORDER, PANEL_ICONS } from '../../lib/panelBar.ts'
import { PANEL_DATA_CONTRACTS, panelIsShowable } from '../../lib/panelDataContracts.ts'
import { PANEL_TITLES } from '../dashboard/panels.tsx'
import { closePanelWindow, openPanelWindow, usePanelWindows } from '../../lib/panelWindows.ts'
import { useAppStore } from '../../store/useAppStore.ts'
import { cn } from '../../lib/cn.ts'
import type { PanelId } from '../../lib/layout.ts'
import type { ScenePaneState } from '../../lib/scenePane.ts'
import { nextScenePaneState } from '../../lib/scenePane.ts'

/**
 * The bottom bar of icons: every function that is not the text and not the
 * scene.
 *
 * Dan, 9 September 2026: *"put it in the right corner and have a bottom bar
 * of icons for various functions and then on the left you have room for your
 * text heavy windows."* The three regions are the text, the corner pane and
 * this. Anything that used to hold a fixed slice of the window and no longer
 * does is reachable from here - moved, not deleted.
 *
 * # Nothing here knows what a panel is called
 *
 * The name is `PANEL_TITLES`' and the description is
 * `PANEL_DATA_CONTRACTS[id].purpose`, both already written and both already
 * tested. `panelBar.ts` adds an icon and an order and stops. A bar with its
 * own copy of thirteen names and thirteen descriptions would be wrong within
 * a month and would look exactly the same while being wrong.
 *
 * # Icons, with the name and the purpose one hover or focus away
 *
 * The same standard `TaskFlowPanel`'s grid already sets: a glyph is scannable
 * at a glance where a row of text labels is not, and the sentence lives in a
 * card that appears on hover **and on keyboard focus**, because a tooltip
 * that only answers a mouse is no answer to somebody tabbing through the bar.
 * `title` carries it as well, for the platform's own tooltip.
 *
 * # A refused panel says why rather than going dead
 *
 * `panelIsShowable` already answers whether a panel means anything with no
 * live character. A disabled button with no reason is the "dead for no stated
 * reason" failure `ActionsPanel` names; the card says "needs a live
 * character" instead, and the button still reports its own name.
 *
 * The bar scrolls horizontally rather than wrapping or clipping. A control
 * off the edge with no way to reach it is the defect `columns.ts` exists to
 * prevent, and this bar has a fixed height by design.
 */
export function IconBar({
  scene,
  onSceneChange,
}: {
  scene: ScenePaneState
  onSceneChange: (next: ScenePaneState) => void
}) {
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const windows = usePanelWindows()
  const live = bridgeConnected && !!character

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-t border-border bg-surface-raised px-2"
      aria-label="Functions"
      role="toolbar"
    >
      <SceneButton scene={scene} onSceneChange={onSceneChange} />

      <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />

      {PANEL_BAR_ORDER.map((id) => (
        <PanelButton
          key={id}
          id={id}
          live={live}
          open={windows.open.includes(id)}
          pending={windows.pending[id]}
          error={windows.errors[id]}
        />
      ))}
    </div>
  )
}

/**
 * One control for the pane's three states, not three.
 *
 * A cycling button rather than a menu, for the reason `layout.ts`'s deck
 * control gives: it is one target, it shows its own state, and it costs no
 * space when not in use. The card names the state it will move to, so nobody
 * has to press it to find out.
 */
function SceneButton({
  scene,
  onSceneChange,
}: {
  scene: ScenePaneState
  onSceneChange: (next: ScenePaneState) => void
}) {
  const next = nextScenePaneState(scene)
  const Icon = scene === 'minimap' ? Eye : scene === 'popped' ? PictureInPicture2 : EyeOff
  const now =
    scene === 'minimap'
      ? 'in the corner'
      : scene === 'popped'
        ? 'in its own window'
        : 'hidden'
  const to = next === 'minimap' ? 'the corner' : next === 'popped' ? 'its own window' : 'hidden'
  const label = `Scene pane: ${now}. Press for ${to}.`

  return (
    <BarButton
      label={label}
      title={PANEL_TITLES.board}
      detail={`${PANEL_DATA_CONTRACTS.board.purpose} Right now: ${now}. Press for ${to}.`}
      active={scene === 'minimap'}
      onClick={() => onSceneChange(next)}
      data-scene-state={scene}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </BarButton>
  )
}

function PanelButton({
  id,
  live,
  open,
  pending,
  error,
}: {
  id: PanelId
  live: boolean
  open: boolean
  pending?: 'opening' | 'closing'
  error?: string
}) {
  const Icon = PANEL_ICONS[id]
  const title = PANEL_TITLES[id]
  const showable = panelIsShowable(id, live)
  const detail = error
    ? error
    : showable
      ? `${PANEL_DATA_CONTRACTS[id].purpose}${open ? ' Open in its own window; press to close it.' : ''}`
      : `${PANEL_DATA_CONTRACTS[id].purpose} Needs a live character, and there is not one yet.`

  return (
    <BarButton
      label={`${title}${open ? ' (open)' : ''}`}
      title={title}
      detail={detail}
      active={open}
      disabled={!showable}
      onClick={() => {
        if (!showable) return
        void (open ? closePanelWindow(id) : openPanelWindow(id, title))
      }}
      data-panel={id}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-4 w-4" aria-hidden />
      )}
    </BarButton>
  )
}

/**
 * The shape every button on the bar shares.
 *
 * One component rather than the same class list written fifteen times, and
 * one card rather than fifteen: the hover/focus reveal is the part most
 * likely to be got subtly wrong in a copy, and a bar where one icon in
 * fifteen has no name is worse than one where none of them do, because
 * nobody notices.
 */
function BarButton({
  label,
  title,
  detail,
  active,
  disabled,
  onClick,
  children,
  ...rest
}: {
  label: string
  title: string
  detail: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span className="group relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active ?? false}
        title={`${title}. ${detail}`}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded border text-ink-muted',
          active ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border hover:bg-surface-overlay hover:text-ink',
          disabled && 'opacity-40'
        )}
        {...rest}
      >
        {children}
      </button>
      {/* Above the bar, not below it: the bar is at the bottom of the window,
          and a card drawn downward would be off the screen - which is the
          same clipping defect in miniature. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-9 left-0 z-50 hidden w-64 rounded border border-border bg-surface-overlay p-2 text-xs text-ink shadow-lg group-hover:block group-focus-within:block"
      >
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-ink-muted">{detail}</span>
      </span>
    </span>
  )
}
