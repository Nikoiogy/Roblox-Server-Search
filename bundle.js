const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Install esbuild if not already installed
exec('npm install --save-dev esbuild', async (error, stdout, stderr) => {
    if (error) {
        console.error(`Error installing esbuild: ${error}`);
        return;
    }
    
    const esbuild = require('esbuild');

    try {
        // Bundle popup
        await esbuild.build({
            entryPoints: ['src/popup/index.js'],
            bundle: true,
            outfile: 'src/popup/popup-bundle.js',
            format: 'iife',
            platform: 'browser',
            target: ['firefox79'],
            bundle: true,
            minify: true,
            sourcemap: true,
            define: {
                'process.env.NODE_ENV': '"production"'
            },
            loader: {
                '.js': 'jsx',
            },
        });

        // Bundle background
        await esbuild.build({
            entryPoints: ['src/background/index.js'],
            bundle: true,
            outfile: 'src/background/background-bundle.js',
            format: 'iife',
            platform: 'browser',
            target: ['firefox79'],
            bundle: true,
            minify: true,
            sourcemap: true,
            define: {
                'process.env.NODE_ENV': '"production"'
            },
        });

        console.log('Build completed successfully!');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
});