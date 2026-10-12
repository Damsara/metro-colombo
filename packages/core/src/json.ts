import { Option } from "effect";

export const parseJson = Option.liftThrowable((text: string): unknown => JSON.parse(text));
