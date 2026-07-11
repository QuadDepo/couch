import { BoxRenderable, parseColor, type RenderContext, type RGBA } from "@opentui/core";
import { DEFAULT_BACKDROP_COLOR, DEFAULT_BACKDROP_OPACITY } from "../themes";
import type { DialogContainerOptions, InternalDialog } from "../types";

export interface BackdropRenderableOptions {
  containerOptions: DialogContainerOptions;
  onClick: () => void;
}

export class BackdropRenderable extends BoxRenderable {
  private _containerOptions: DialogContainerOptions;

  constructor(ctx: RenderContext, options: BackdropRenderableOptions) {
    super(ctx, {
      id: "dialog-backdrop",
      position: "absolute",
      left: 0,
      top: 0,
      width: ctx.width,
      height: ctx.height,
      backgroundColor: BackdropRenderable.computeColor(undefined, options.containerOptions),
      visible: false,
      onMouseUp: options.onClick,
    });
    this._containerOptions = options.containerOptions;
  }

  public updateStyle(dialog?: InternalDialog): void {
    this.backgroundColor = BackdropRenderable.computeColor(dialog, this._containerOptions);
  }

  public updateDimensions(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  private static computeColor(
    dialog: InternalDialog | undefined,
    containerOptions: DialogContainerOptions,
  ): RGBA {
    const color = dialog?.backdropColor ?? containerOptions.backdropColor ?? DEFAULT_BACKDROP_COLOR;
    const rgba = parseColor(color);
    rgba.a = DEFAULT_BACKDROP_OPACITY / 255;
    return rgba;
  }
}
