# ZUI

**A modern UI kit made for machines.**

As AGI accelerates, human-made abstractions will fade. This is why we have returned to first principles and built a UI kit with sound fundamentals and primitives in plain React, TypeScript, and CSS modules.

The design embraces a minimalist future aesthetic with a hint of techno-optimism—clean, functional, and forward-looking.

This is the official design system for the Cypher ecosystem and free to use and replicate under the MIT license.

## Features

- **First Principles Design** - Built from the ground up with fundamentals that transcend fleeting trends
- **Plain Tech Stack** - Pure React, TypeScript, and CSS modules—no magic, no bloat
- **Sound Primitives** - Composable components that work like building blocks
- **Tree-shakeable** - Import only what you need
- **Fully Typed** - Complete TypeScript support
- **Machine-Ready** - Designed for both human and AI developers

## Installation

```bash
npm install @cypher-asi/zui
```

## Usage

```tsx
import { Button, Card } from '@cypher-asi/zui';
import '@cypher-asi/zui/styles';

function App() {
  return (
    <Card>
      <Button variant="primary">Click me</Button>
    </Card>
  );
}
```

## Development

This repository contains:
- `src/` - Component library source code
- `inspector/` - Component inspector/playground app
- `docs-site/` - Documentation site

### Running locally

```bash
# Install dependencies
npm install

# Run inspector (component playground)
npm run dev:inspector

# Run documentation site
npm run dev:docs

# Run tests
npm test
```

## License

MIT
