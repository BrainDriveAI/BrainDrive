# BrainDrive PluginStudio

A drag-and-drop interface for building AI powered applications using BrainDrive Plugins.

Create responsive, interactive applications without coding. Built for both developers and everyday owners looking to customize their BrainDrive.

Use existing plugins or [create your own](DEVELOPER_QUICK_START). The only limit is your imagination. 

![BrainDrive Studio](https://github.com/BrainDriveAI/BrainDrive/blob/main/images/Page%20Builder%20Screenshot.png)

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

- [Installation Guide](../INSTALL.md) - Complete instructions how to setup your BrainDrive

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

 ## Full Project Documentation

 [BrainDrive Documentation Index](DOCUMENTATION_INDEX)

 ## Questions? 

 Post at [community.braindrive.ai](https://community.braindrive.ai). We're here to help build the future of user owned AI together. 

## License

Licensed under the [MIT License](LICENSE). Your AI. Your Rules.
