import clsx from 'clsx'
import { ComponentProps } from 'react'
import { MdArrowBack } from 'react-icons/md'

interface PageProps extends ComponentProps<'div'> {
  headline: string
  backLabel?: string
  onBack?: () => void
}
export const Page: React.FC<PageProps> = ({
  className,
  children,
  headline,
  backLabel,
  onBack,
  ...props
}) => {
  return (
    <div className={clsx('scroll bg-background h-full', className)} {...props}>
      <header className="SettingsHeader border-surface-variant/60 bg-background/90 sticky top-0 z-20 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          {onBack && (
            <button
              type="button"
              className="text-on-surface hover:bg-surface-variant/60 flex h-11 w-11 items-center justify-center rounded-full active:scale-95"
              aria-label={backLabel}
              title={backLabel}
              onClick={onBack}
            >
              <MdArrowBack size={24} />
            </button>
          )}
          <h1 className="typescale-title-large text-on-surface font-semibold">
            {headline}
          </h1>
        </div>
      </header>
      <div className="mx-auto max-w-3xl p-5 sm:p-7">{children}</div>
    </div>
  )
}
