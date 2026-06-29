import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteParser from "svelte-eslint-parser";
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
    ...ts.configs.recommendedTypeChecked,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: { ...globals.browser },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
		},
		rules: {
			"no-undef": 'off',
			"no-unused-vars": "off",
			"svelte/prefer-svelte-reactivity": 'off',
			"svelte/require-each-key": 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            "@typescript-eslint/no-namespace": "off",
    		"@typescript-eslint/no-unused-vars": ["error", {
				"argsIgnorePattern": "^_",
        		"destructuredArrayIgnorePattern": "^_",
				"varsIgnorePattern": "^_",
			}],
		}
	},
	{
		files: [
			'**/*.svelte',
			'**/*.svelte.ts',
			'**/*.svelte.js'
		],
		languageOptions: {
            parser: svelteParser,
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
    {
        files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
        ...ts.configs.disableTypeChecked,
    }
);
