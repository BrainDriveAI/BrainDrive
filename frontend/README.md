# BrainDrive PluginStudio

## Overview

BrainDrive PluginStudio is a powerful and flexible frontend application for creating, managing, and visualizing plugins within the BrainDrive ecosystem. It provides a drag-and-drop interface for building plugin-based applications with a responsive grid layout system.

PluginStudio allows developers and non-technical users alike to create dynamic, interactive applications by arranging and configuring plugins on a canvas. The studio supports multiple view modes (desktop, tablet, mobile) for responsive design and provides tools for managing pages, routes, and component configurations.

## Tech Stack

The PluginStudio frontend is built using the following technologies:

- **[React](https://reactjs.org/)** (v18.3.1): A JavaScript library for building user interfaces
- **[TypeScript](https://www.typescriptlang.org/)**: Typed JavaScript for better developer experience
- **[Vite](https://vitejs.dev/)**: Next-generation frontend tooling for fast development and optimized builds
- **[Material UI](https://mui.com/)** (v5.14.4): React UI framework with Material Design components
- **[React Router](https://reactrouter.com/)** (v7.2.0): Declarative routing for React applications
- **[React Grid Layout](https://github.com/react-grid-layout/react-grid-layout)**: Draggable and resizable grid layout
- **[Axios](https://axios-http.com/)**: Promise-based HTTP client
- **[Zod](https://zod.dev/)**: TypeScript-first schema validation

## Features

- **Plugin Management**: Browse, install, and manage plugins
- **Visual Editor**: Drag-and-drop interface for arranging plugins on a canvas
- **Responsive Design**: Support for desktop, tablet, and mobile layouts
- **Page Management**: Create, edit, and organize pages
- **Route Management**: Define and manage navigation routes
- **Component Configuration**: Configure plugin properties through a user-friendly interface
- **Theme Support**: Light and dark mode with customizable themes
- **Authentication**: Secure user authentication and authorization
- **Real-time Preview**: Instantly preview changes as you build
- **JSON Export/Import**: Export and import configurations as JSON
- **Error Handling**: Robust error boundaries and error reporting
- **Service Architecture**: Modular service-based architecture for extensibility

## Installation

### Prerequisites

- Node.js 16.x or higher
- npm 7.x or higher or yarn 1.22.x or higher
- Git

### Windows

1. Install Node.js from [nodejs.org](https://nodejs.org/)

2. Clone the repository and navigate to the frontend directory:
   ```
   git clone https://github.com/BrainDriveAI/BrainDrive.git
   cd BrainDrive/frontend
   ```

3. Install dependencies:
   ```
   npm install
   # or
   yarn install
   ```

4. Create a `.env` file based on the example configuration (see Configuration section)

### macOS

1. Install Node.js using Homebrew:
   ```
   brew install node
   ```

2. Clone the repository and navigate to the frontend directory:
   ```
   git clone https://github.com/BrainDriveAI/BrainDrive.git
   cd BrainDrive/frontend
   ```

3. Install dependencies:
   ```
   npm install
   # or
   yarn install
   ```

4. Create a `.env` file based on the example configuration (see Configuration section)

### Linux

1. Install Node.js using your distribution's package manager:
   ```
   # Ubuntu/Debian
   sudo apt update
   sudo apt install nodejs npm
   
   # Fedora
   sudo dnf install nodejs
   
   # Arch Linux
   sudo pacman -S nodejs npm
   ```

2. Clone the repository and navigate to the frontend directory:
   ```
   git clone https://github.com/BrainDriveAI/BrainDrive.git
   cd BrainDrive/frontend
   ```

3. Install dependencies:
   ```
   npm install
   # or
   yarn install
   ```

4. Create a `.env` file based on the example configuration (see Configuration section)

## Configuration

Create a `.env` file in the frontend directory with the following configuration options:

```
# API Configuration
VITE_API_URL=http://localhost:8005
VITE_API_TIMEOUT=10000

# Environment
NODE_ENV=development

# Development Only - Temporary Auto Login (Remove in production)
VITE_DEV_AUTO_LOGIN=true
VITE_DEV_EMAIL=your-email@example.com
VITE_DEV_PASSWORD=your-password
```

or can copy the .env.example to .env

> **Note**: For production, make sure to set appropriate values and remove development-specific settings.

## Running the Application

### Development Mode

To run the PluginStudio in development mode with hot-reload:

```
# Using npm
npm run dev

# Using yarn
yarn dev
```

This will start the development server at http://localhost:5173 (or another port if 5173 is in use).

### Building for Production

To build the application for production:

```
# Using npm
npm run build

# Using yarn
yarn build
```

The built files will be in the `dist` directory.

### Preview Production Build

To preview the production build locally:

```
# Using npm
npm run preview

# Using yarn
yarn preview
```

## Backend Integration

PluginStudio is designed to work with the BrainDrive Backend API. Make sure the backend server is running before starting the frontend application.

The backend provides:
- Authentication services
- Plugin data storage and retrieval
- User settings and preferences
- Page and route management
- Component configuration storage

See the [Backend README](../backend/README.md) for instructions on setting up and running the backend server.

## Development Guidelines

- Use TypeScript for all new code
- Follow the existing component structure and naming conventions
- Use Material UI components for consistency
- Consider adding tests for critical features
- Document components and functions with JSDoc comments
- Use the service architecture for backend communication
- Follow the React hooks pattern for state management
- Use context providers for shared state

## Project Structure

- `src/`: Source code
  - `components/`: Reusable UI components
  - `contexts/`: React context providers
  - `features/`: Feature-specific code
    - `plugin-manager/`: Plugin management feature
    - `plugin-studio/`: Plugin studio editor feature
  - `hooks/`: Custom React hooks
  - `pages/`: Page components
  - `plugin/`: Plugin system code
  - `services/`: Service layer for API communication
  - `App.tsx`: Main application component
  - `main.tsx`: Application entry point
  - `routes.tsx`: Application routes

## License

[Your License Here]