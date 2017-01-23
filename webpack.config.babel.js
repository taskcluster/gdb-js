import path from 'path'
import webpack from 'webpack'

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
      'process.env': {
        'NODE_ENV': JSON.stringify(process.env.NODE_ENV)
      }
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

  externals: ['debug', 'highland'],

  devtool: 'source-map'
}

