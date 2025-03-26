import { addMessages, locale } from 'svelte-i18n';

import en from '../locales/en.json';
import zh_cn from '../locales/zh-cn.json';

addMessages('en', en);
addMessages('zh-cn', zh_cn);
locale.set('en');