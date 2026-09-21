import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({base:'/admin/',plugins:[react(),tailwindcss()],server:{port:5174,proxy:{'/admin/login':'http://127.0.0.1:8000','/admin-login.css':'http://127.0.0.1:8000','/api':{target:'http://127.0.0.1:8000',changeOrigin:true},'/login.html':'http://127.0.0.1:8000','/login.css':'http://127.0.0.1:8000','/login.js':'http://127.0.0.1:8000'}}});
