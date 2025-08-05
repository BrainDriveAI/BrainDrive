# Service Bridges Overview & Examples

Plugins communicate through standardized bridges, not direct calls. This means:

- ✅ No plugin dependencies or conflicts
- ✅ No breaking changes when core updates
- ✅ No intimate system knowledge needed

Designed to save you 90% of typical dev time.

> **Learn by doing**: 

Each service bridge has working examples with visual demonstrations and full documentation. Install them, interact with them, and copy the proven patterns.

| Service Bridge         | Working Example                         | What You'll See                              | Dev Guide                         |
|------------------------|------------------------------------------|-----------------------------------------------|------------------------------|
| 🔗 API Bridge          | [`ServiceExample_API`](https://github.com/DJJones66/ServiceExample_API)               | Authentication, streaming, error handling     | [Guide](https://github.com/DJJones66/ServiceExample_API/blob/main/DEVELOPER_GUIDE.md)|
| ⚡ Event Bridge        | [`ServiceExample_Events`](https://github.com/DJJones66/ServiceExample_Events)            | Real-time messaging between modules           | [Guide](https://github.com/DJJones66/ServiceExample_Events/blob/main/DEVELOPER_GUIDE.md) |
| 🎨 Theme Bridge        | [`ServiceExample_Theme`](https://github.com/DJJones66/ServiceExample_Theme)             | Automatic light/dark theme switching          | [Guide](https://github.com/DJJones66/ServiceExample_Theme/blob/main/DEVELOPER_GUIDE.md) |
| ⚙️ Settings Bridge     | [`ServiceExample_Settings`](https://github.com/DJJones66/ServiceExample_Settings)          | Multi-scope configuration management          | [Guide](https://github.com/DJJones66/ServiceExample_Settings/blob/main/DEVELOPER_GUIDE.md) |
| 📍 PageContext Bridge  | [`ServiceExample_PageContext`](https://github.com/DJJones66/ServiceExample_PageContext)       | Location-aware plugin behavior                | [Guide](https://github.com/DJJones66/ServiceExample_PageContext/blob/main/DEVELOPER_GUIDE.md) |
| 💾 PluginState Bridge  | [`ServiceExample_PluginState`](https://github.com/DJJones66/ServiceExample_PluginState)       | Persistent data storage                       | [Guide](https://github.com/DJJones66/ServiceExample_PluginState/blob/main/DEVELOPER_GUIDE.md)|


**How to explore:**

1. Follow the [plugin developer quick start](https://github.com/BrainDriveAI/BrainDrive/blob/main/PLUGIN_DEVELOPER_QUICKSTART.md) to get up and running
2. Install any of the above service bridge examples through BrainDrive's Plugin Manager
3. Add the demo modules to a page using drag & drop
4. Interact with the components to see the service in action
5. Review dev guide and study the code patterns in the repository
6. Copy those patterns to your own plugins

## Questions?

Post in the developer forum at [community.braindrive.ai](https://community.braindrive.ai/). We're here to help build the future of user-owned AI together. 



