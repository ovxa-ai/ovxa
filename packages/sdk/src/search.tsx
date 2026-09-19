import * as React from "react";
import {
  OVXASurfaceView,
  cx,
  themeStyle,
  useOvxaSurface,
  type OvxaTheme,
  type SurfacePhase,
  type SurfaceViewProps,
} from "@ovxa/react";
import type { JsonValue } from "@ovxa/schema";
import { OvxaRoot, type OvxaConnectionProps } from "./ovxa";
import { defaultUseCases, filterUseCases, type UseCase } from "./use-cases";

export type OvxaSearchProps = OvxaConnectionProps &
  SurfaceViewProps & {
    /** Application data every generated interface may bind to. */
    data?: Record<string, JsonValue>;
    /** Intents offered before the user types, and filtered as they do. */
    suggestions?: readonly UseCase[];
    /** Generate this intent on mount. */
    defaultIntent?: string;
    placeholder?: string;
    /** Copy shown above the suggestions before anything has been asked. */
    prompt?: string;
    autoFocus?: boolean;
    locale?: string;
    /** Fires when an intent is submitted, before generation starts. */
    onIntent?: (intent: string) => void;
    theme?: OvxaTheme;
  };

/**
 * A search box for interfaces.
 *
 *   <OvxaSearch data={workspace} />
 *
 * The user types what they want to do; the engine answers with the interface
 * that does it, rendered underneath. Suggestions come from `defaultUseCases`
 * until you pass your own. Keyboard: arrows move through suggestions, Enter
 * submits, Escape closes the list and then clears the box.
 */
export function OvxaSearch({
  client,
  apiKey,
  baseUrl,
  components,
  actions,
  ...search
}: OvxaSearchProps): React.ReactElement {
  return (
    <OvxaRoot
      {...(client ? { client } : {})}
      {...(apiKey ? { apiKey } : {})}
      {...(baseUrl ? { baseUrl } : {})}
      {...(components ? { components } : {})}
      {...(actions ? { actions } : {})}
    >
      <SearchBody {...search} />
    </OvxaRoot>
  );
}

type SearchBodyProps = Omit<OvxaSearchProps, keyof OvxaConnectionProps>;

const STATUS_LABEL: Record<SurfacePhase["status"], string> = {
  idle: "",
  planning: "Choosing an interface",
  streaming: "Building",
  ready: "Ready",
  error: "Failed",
};

function SearchBody({
  data,
  suggestions = defaultUseCases,
  defaultIntent = "",
  placeholder = "What do you need to do?",
  prompt = "Describe the task. The engine picks the interface.",
  autoFocus = false,
  locale,
  onIntent,
  loading,
  empty,
  error,
  onAction,
  className,
  theme,
}: SearchBodyProps): React.ReactElement {
  const listId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState(defaultIntent);
  const [intent, setIntent] = React.useState(defaultIntent.trim());
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);

  const result = useOvxaSurface({
    intent,
    ...(data ? { state: data } : {}),
    ...(locale ? { locale } : {}),
  });
  const status = result.phase.status;
  const busy = status === "planning" || status === "streaming";

  const matches = React.useMemo(() => filterUseCases(suggestions, query), [suggestions, query]);
  const showList = open && matches.length > 0;

  const submit = React.useCallback(
    (value: string) => {
      const next = value.trim();
      if (next.length === 0) return;
      setQuery(next);
      setOpen(false);
      setActive(-1);
      onIntent?.(next);
      if (next === intent) {
        result.regenerate();
      } else {
        setIntent(next);
      }
    },
    [intent, onIntent, result],
  );

  /** Clears the box and the result. Escape only ever touches the box. */
  const clear = React.useCallback(() => {
    setQuery("");
    setIntent("");
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
      return;
    }
    if (event.key === "Enter") {
      const chosen = active >= 0 ? matches[active] : undefined;
      if (chosen && showList) {
        event.preventDefault();
        submit(chosen.intent);
      }
      return;
    }
    if (event.key === "Escape") {
      if (showList) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query.length > 0) {
        event.preventDefault();
        setQuery("");
      }
    }
  };

  const canSubmit = query.trim().length > 0 && query.trim() !== intent;

  const activeId = active >= 0 && showList ? `${listId}-${active}` : undefined;

  return (
    <div className={cx("ovxa", "ovxa-search", className)} style={themeStyle(theme)}>
      <form
        role="search"
        className="ovxa-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
      >
        <div className="ovxa-search-bar" data-status={status}>
          <span className="ovxa-search-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.2 13.2 17 17" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className="ovxa-search-input"
            type="text"
            role="combobox"
            aria-label="Describe what you need to do"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            {...(activeId ? { "aria-activedescendant": activeId } : {})}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="ovxa-search-tools">
            {busy ? (
              <span className="ovxa-spinner" role="status" aria-label={STATUS_LABEL[status]} />
            ) : canSubmit ? (
              <kbd className="ovxa-search-hint" aria-hidden="true">
                ↵
              </kbd>
            ) : null}
            {query.length > 0 || intent.length > 0 ? (
              <button
                type="button"
                className="ovxa-search-clear"
                aria-label="Clear"
                onMouseDown={(event) => event.preventDefault()}
                onClick={clear}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </span>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label="Suggested tasks"
          className="ovxa-search-list"
          hidden={!showList}
        >
          {matches.map((useCase, index) => (
            <li
              key={useCase.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cx("ovxa-search-option", index === active && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => submit(useCase.intent)}
            >
              <span className="ovxa-search-option-title">{useCase.title}</span>
              <span className="ovxa-search-option-intent">{useCase.intent}</span>
            </li>
          ))}
        </ul>
      </form>

      {intent.length > 0 ? (
        <div className="ovxa-search-result">
          <div className="ovxa-search-status" aria-live="polite">
            <span className="ovxa-muted">{STATUS_LABEL[status]}</span>
            {status === "ready" || status === "error" ? (
              <button type="button" className="ovxa-link" onClick={result.regenerate}>
                Regenerate
              </button>
            ) : null}
          </div>
          <OVXASurfaceView
            {...result}
            {...(loading !== undefined ? { loading } : {})}
            {...(empty !== undefined ? { empty } : {})}
            {...(error ? { error } : {})}
            {...(onAction ? { onAction } : {})}
          />
        </div>
      ) : (
        <div className="ovxa-search-empty">
          <p className="ovxa-muted">{prompt}</p>
          <div className="ovxa-search-chips">
            {suggestions.map((useCase) => (
              <button
                key={useCase.id}
                type="button"
                className="ovxa-chip-btn"
                title={useCase.intent}
                onClick={() => submit(useCase.intent)}
              >
                {useCase.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
