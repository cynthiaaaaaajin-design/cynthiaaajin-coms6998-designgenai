const destinations = {
  coast: {
    name: "A long weekend in Lisbon",
    location: "Portugal",
    emoji: "☀",
    style: "coast",
    dates: "May 22 – 26",
    people: "AL,JK,ME",
  },
  mountain: {
    name: "Fresh air, good company",
    location: "The Dolomites, Italy",
    emoji: "△",
    style: "mountain",
    dates: "Jun 14 – 20",
    people: "SR,AL,ME",
  },
  city: {
    name: "A little Kyoto adventure",
    location: "Kyoto, Japan",
    emoji: "✿",
    style: "city",
    dates: "Oct 8 – 15",
    people: "JK,SR,ME",
  },
};
export function TripCard({
  destination = "coast",
}: {
  destination?: keyof typeof destinations;
}) {
  const trip = destinations[destination];
  return (
    <article className="trip-card">
      <div className={`destination-art ${trip.style}`}>
        <span className="art-sun" />
        <span className="art-hill hill-back" />
        <span className="art-hill hill-front" />
        <span className="destination-label">{trip.location}</span>
        <span className="art-symbol" aria-hidden="true">
          {trip.emoji}
        </span>
        <span className="sample-label">Sample trip</span>
      </div>
      <div className="p-6">
        <p className="eyebrow mb-2">{trip.dates} · Inspiration</p>
        <h3 className="text-xl font-semibold tracking-tight">{trip.name}</h3>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex -space-x-2" aria-label="Three sample travelers">
            {trip.people.split(",").map((person, i) => (
              <span key={person} className={`avatar avatar-${i}`}>
                {person}
              </span>
            ))}
          </div>
          <span className="text-xs text-slate-500">Good times ahead ↗</span>
        </div>
      </div>
    </article>
  );
}
