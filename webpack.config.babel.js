import path from 'path'
import webpack from 'webpack'
import nodeExternals from 'webpack-node-externals'

const PRODUCTION = process.env.NODE_ENV === 'production'

export default {
  entry: path.resolve('src/index.js'),

  output: {
    path: path.resolve('lib'),
    filename: 'index.js',
    libraryTarget: 'commonjs2'
  },

  plugins: [
    new webpack.NoErrorsPlugin(),
    new webpack.DefinePlugin({
      NODE_ENV: JSON.stringify(process.env.NODE_ENV)
    })
  ],

  module: {
    loaders: [{
      test: /\.js$/,
      loader: 'babel',
      exclude: /node_modules/
    }, {
      test: /\.py$/,
      loader: 'raw'
    }, {
      test: /\.pegjs$/,
      loader: 'pegjs'
    }]
  },

  externals: [nodeExternals(), 'gdb-js'],

  postcss: () => [precss, autoprefixer],

  devtool: 'source-map'
}

