const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { ModuleFederationPlugin } = require("webpack").container;
const deps = require("./package.json").dependencies;

module.exports = {
  mode: "development",
  entry: "./src/index",
  output: {
    path: path.resolve(__dirname, '../../backend/plugins/BrainDriveBasicAIChat/frontend/dist'),
    publicPath: "auto",
    clean: true,
    library: {
      type: 'var',
      name: 'BrainDriveBasicAIChat'
    }
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          'style-loader', 
          'css-loader',
          'postcss-loader'
        ]
      }
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: "BrainDriveBasicAIChat",
      library: { type: "var", name: "BrainDriveBasicAIChat" },
      filename: "remoteEntry.js",
      exposes: {
        "./ComponentModelSelection": "./src/ComponentModelSelection",
        "./AIPromptChat": "./src/components/AIPromptChat/index",
        "./AIChatHistory": "./src/AIChatHistory"


      },
      shared: {
        react: { 
          singleton: true,
          requiredVersion: deps.react,
          eager: true
        },
        "react-dom": { 
          singleton: true,
          requiredVersion: deps["react-dom"],
          eager: true
        }
      }
    }),
    new HtmlWebpackPlugin({
      template: "./public/index.html",
    }),
  ],
  devServer: {
    port: 9006,
    static: {
      directory: path.join(__dirname, "public"),
    },
    hot: true,
  },
};
