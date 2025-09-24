import React from 'react';
import { RenderMode } from '../types';
import { LayoutEngineBase, LayoutEngineBaseProps } from './LayoutEngineBase';

export type StudioLayoutEngineProps = Omit<LayoutEngineBaseProps, 'mode'>;

export const StudioLayoutEngine: React.FC<StudioLayoutEngineProps> = (props) => {
  return <LayoutEngineBase {...props} mode={RenderMode.STUDIO} />;
};

export default StudioLayoutEngine;
