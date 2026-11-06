import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ParentApp } from './ParentApp';
import { DeviceApp } from './DeviceApp';
import './styles.css';

const isDevice = window.location.pathname.startsWith('/device');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isDevice ? <DeviceApp /> : <ParentApp />}</StrictMode>,
);
