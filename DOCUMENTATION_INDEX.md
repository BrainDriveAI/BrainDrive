Up to date list of all BrainDrive repos & corresponding documentation. 

## Start here: 

[Plugin Developer Quick Start Guide](https://github.com/BrainDriveAI/BrainDrive/blob/main/PLUGIN_DEVELOPER_QUICKSTART.md) - Start building plugins for your BrainDrive, fast.

## All Docs:

**[BrainDrive Core Repo](https://github.com/BrainDriveAI/BrainDrive) - Front End, Backend, and Plugin System**

* [README](https://github.com/BrainDriveAI/BrainDrive/blob/main/README.md): What BrainDrive is, how it works, & why it matters

* [Install Guide](https://github.com/BrainDriveAI/BrainDrive/blob/main/INSTALL.md): Windows, macOS, & Linux.

* [Frontend README](https://github.com/BrainDriveAI/BrainDrive/blob/main/frontend/README.md): Architecture, stack, features, & UI dev guidelines.

* [Backend README](https://github.com/BrainDriveAI/BrainDrive/blob/main/backend/README.md): Setup, API use, data ownership, & deployment.

* [Plugin README](https://github.com/BrainDriveAI/BrainDrive/blob/main/plugins/README.md): Dev workflow & modular architecture overview.


**[BrainDrive Plugin Template Repo](https://github.com/BrainDriveAI/PluginTemplate) - Boilerplate to jumpstart your development.**

* [Readme](https://github.com/BrainDriveAI/PluginTemplate/blob/main/README.md) \- Dev workflow, testing & customization overview.

* [Dev Guide](https://github.com/BrainDriveAI/PluginTemplate/blob/main/DEVELOPMENT.md): How to customize the template for your use case.

* [Life Cycle Manager Customization Guide](https://github.com/BrainDriveAI/PluginTemplate/blob/main/references/LIFECYCLE_MANAGER_CUSTOMIZATION_GUIDE.md) \- Customize how plugins integrate 

* [Life Cycle Manager Reference Guide](https://github.com/BrainDriveAI/PluginTemplate/blob/main/references/Lifecycle-Manager-Reference.md) \- Overview & descriptions of each function

* [Error Handling Guide](https://github.com/BrainDriveAI/PluginTemplate/blob/main/DEVELOPER_GUIDE.md) \- How to implement error handling.

* [Error Handling Reference](https://github.com/BrainDriveAI/PluginTemplate/blob/main/ERROR_HANDLING_GUIDE.md) \- Components, patterns, & best practices.

* [Module Data Field Reference](https://github.com/BrainDriveAI/PluginTemplate/blob/main/references/Module-Data-Field-Reference.md) \- Module\_data array field descriptions

* [Plugin Data Field Reference](https://github.com/BrainDriveAI/PluginTemplate/blob/main/references/Plugin-Data-Field-Reference.md) \- Plugin\_data dictionary field descriptions.

**[BrainDrive Chat Plugin Repo](https://github.com/DJJones66/BrainDriveChat/tree/main) - AI Chat Interface plugin. Includes chat, model select & convo history management with light/dark theme support.**

* [Readme](https://github.com/DJJones66/BrainDriveChat/blob/main/README.md) \- Overview and Installation
  
* [Summary](https://github.com/DJJones66/BrainDriveChat/blob/main/PLUGIN_SUMMARY.md) \- Modular Implementation Summary

## Service Bridge Examples

Plugins communicate through 6 standardized [service bridges](https://github.com/BrainDriveAI/DocDrafts/blob/main/Service%20Bridges.md), not direct calls. No plugin dependencies, breaking changes, or intimate system knowledge needed. 

**1. [Events Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_Events) \- Demonstrates real-time inter-module communication**

* [Readme](https://github.com/DJJones66/ServiceExample_Events/blob/main/README.md)  
* [Release](https://github.com/DJJones66/ServiceExample_Events/blob/main/RELEASE.md)   
* [Dev Guide](https://github.com/DJJones66/ServiceExample_Events/blob/main/DEVELOPER_GUIDE.md)

**2. [Theme Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_Theme) \- Demonstrates real-time theme management**

* [Readme](http://ServiceExample_Theme)   
* [Release](https://github.com/DJJones66/ServiceExample_Theme/blob/main/RELEASE.md)   
* [Dev Guide](https://github.com/DJJones66/ServiceExample_Theme/blob/main/DEVELOPER_GUIDE.md)   
* [Error Handling](https://github.com/DJJones66/ServiceExample_Theme/blob/main/ERROR_HANDLING_GUIDE.md)

**3. [Settings Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_Settings) \- Demonstrates persistent configuration management**

* [Readme](https://github.com/DJJones66/ServiceExample_Settings/blob/main/README.md)  
* [Release](https://github.com/DJJones66/ServiceExample_Settings/blob/main/RELEASE.md)  
* [Dev Guide](https://github.com/DJJones66/ServiceExample_Settings/blob/main/DEVELOPER_GUIDE.md)

**4. [Page Context Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_PageContext) \- Demonstrates page context monitoring & information retrieval**

* [Readme](https://github.com/DJJones66/ServiceExample_PageContext/blob/main/README.md)  
* [Release](https://github.com/DJJones66/ServiceExample_PageContext/blob/main/RELEASE.md)  
* [Dev Reference](https://github.com/DJJones66/ServiceExample_PageContext/blob/main/DEVELOPER_GUIDE.md)  
* [Dev Guide](https://github.com/DJJones66/ServiceExample_PageContext/blob/main/DEVELOPMENT.md)

**5. [Plugin State Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_PluginState) \- Demonstrates persistent state management**

* [Readme](https://github.com/DJJones66/ServiceExample_PluginState/blob/main/README.md)  
* [Release](https://github.com/DJJones66/ServiceExample_PluginState/blob/main/RELEASE.md)  
* [Dev Reference](http://DEVELOPER_GUIDE)   
* [Dev Guide](https://github.com/DJJones66/ServiceExample_PluginState/blob/main/DEVELOPMENT.md) 

**6. [API Bridge Demo Repo](https://github.com/DJJones66/ServiceExample_API) \- Demonstrates Internal backend CRUD operations & external API connectivity testing.**

* [Readme](https://github.com/DJJones66/ServiceExample_API/blob/main/README.md)  
* [Release](https://github.com/DJJones66/ServiceExample_API/blob/main/RELEASE.md)  
* [Dev Reference](https://github.com/DJJones66/ServiceExample_API/blob/main/DEVELOPER_GUIDE.md)   
* [Dev Guide](https://github.com/DJJones66/ServiceExample_API/blob/main/DEVELOPMENT.md)

## 

## More Resources

[Build Archive Script](https://github.com/DJJones66/BrainDriveScripts/blob/main/build_archive.py): Python utility to package plugins for distribution, skipping dev-only files.  
[API Reference](http://localhost:8005/api/v1/docs) (BrainDrive must be running to access)

## Have Questions?

Post them in the developer forum at [community.braindrive.ai](community.braindrive.ai) We're here to help build the future of user-owned AI together. 

