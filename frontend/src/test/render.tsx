import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";
import type { ReactElement } from "react";

type ProviderOptions = {
  routerProps?: MemoryRouterProps;
};

function Providers({
  children,
  routerProps,
}: {
  children: React.ReactNode;
  routerProps?: MemoryRouterProps;
}): ReactElement {
  return <MemoryRouter {...routerProps}>{children}</MemoryRouter>;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & ProviderOptions,
): ReturnType<typeof render> {
  const { routerProps, ...renderOptions } = options ?? {};

  return render(ui, {
    wrapper: ({ children }) => (
      <Providers routerProps={routerProps}>{children}</Providers>
    ),
    ...renderOptions,
  });
}

export { renderWithProviders as render };
export * from "@testing-library/react";
