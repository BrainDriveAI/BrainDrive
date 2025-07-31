# BrainDrive Service Bridges Overview & Examples

Plugins communicate through standardized bridges, not direct calls. This means:

- ✅ No plugin dependencies or conflicts
- ✅ No breaking changes when core updates
- ✅ No intimate system knowledge needed

Designed to save you 90% of typical dev time.

> **Learn by doing**: 

Each service bridge has working examples with visual demonstrations and full documentation. Install them, interact with them, and copy the proven patterns.

| Service Bridge         | Working Example                         | What You'll See                              | Docs                         |
|------------------------|------------------------------------------|-----------------------------------------------|------------------------------|
| 🔗 API Bridge          | [`ServiceExample_API`](#)               | Authentication, streaming, error handling     | [Guide](#) / [Reference](#) |
| ⚡ Event Bridge        | [`ServiceExample_Events`](#)            | Real-time messaging between modules           | [Guide](#) / [Reference](#) |
| 🎨 Theme Bridge        | [`ServiceExample_Theme`](#)             | Automatic light/dark theme switching          | [Guide](#) / [Reference](#) |
| ⚙️ Settings Bridge     | [`ServiceExample_Settings`](#)          | Multi-scope configuration management          | [Guide](#) / [Reference](#) |
| 📍 PageContext Bridge  | [`ServiceExample_PageContext`](#)       | Location-aware plugin behavior                | [Guide](#) / [Reference](#) |
| 💾 PluginState Bridge  | [`ServiceExample_PluginState`](#)       | Persistent data storage                       | [Guide](#) / [Reference](#) |


**How to explore:**

1. Follow the [plugin developer quick start](#) to get up and running
2. Install any of the above service bridge examples through BrainDrive's Plugin Manager
3. Add the demo modules to a page using drag & drop
4. Interact with the components to see the service in action
5. Review dev guide and study the code patterns in the repository
6. Copy those patterns to your own plugins

## Questions?

We're here to help. Post in the developer forum at community.braindrive.ai



