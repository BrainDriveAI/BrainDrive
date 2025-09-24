import React from 'react';
import { RenderMode } from '../types';
import DisplayLayoutEngineImpl, { DisplayLayoutEngineProps as DisplayLayoutEngineImplProps } from './DisplayLayoutEngineImpl';

export type DisplayLayoutEngineProps = DisplayLayoutEngineImplProps;

export const DisplayLayoutEngine: React.FC<DisplayLayoutEngineProps> = (props) => {
  if (process.env.NODE_ENV === 'development' && props.mode === RenderMode.STUDIO) {
    console.warn('[DisplayLayoutEngine] Studio mode detected. Use StudioLayoutEngine instead to avoid controller V2 guards.');
  }

  return <DisplayLayoutEngineImpl {...props} />;
};

export default DisplayLayoutEngine;
