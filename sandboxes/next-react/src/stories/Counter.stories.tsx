import type { Meta, StoryObj } from "storybook-next-rsbuild";
import { Counter } from "./Counter";

export default { component: Counter } as Meta<typeof Counter>;

export const Default: StoryObj<typeof Counter> = {};
