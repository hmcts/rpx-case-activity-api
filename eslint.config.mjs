import { defineConfig } from "eslint/config";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    extends: compat.extends("airbnb-base"),

    languageOptions: {
        ecmaVersion: 2020,
        globals: {
            ...globals.mocha,
            ...globals.jasmine,
        },
    },
    rules: {
        "comma-dangle": 0,
        "arrow-body-style": 0,
        "no-param-reassign": [2, { props: false }],
        "no-unused-vars": ["error", { vars: "all", args: "after-used", ignoreRestSiblings: true, caughtErrors: "none" }],
        "linebreak-style": ["error", process.platform === "win32" ? "windows" : "unix"],
    },
}]);
