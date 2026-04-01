interface LumaSpinProps {
  /** CSS color value for the spinner strokes. Defaults to the app's primary navy. */
  color?: string;
}

export const LumaSpin = ({ color = '#091426' }: LumaSpinProps) => {
  const shadow = `inset 0 0 0 3px ${color}`;
  return (
    <div className="relative w-[65px] aspect-square">
      <span
        className="absolute rounded-[50px] animate-loader"
        style={{ boxShadow: shadow }}
      />
      <span
        className="absolute rounded-[50px] animate-loader"
        style={{ boxShadow: shadow, animationDelay: '-1.25s' }}
      />
    </div>
  );
};
