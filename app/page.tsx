import { supabase } from "@/lib/supabase";

export default async function Home() {
    const { data: movies, error } = await supabase
        .from("movies")
        .select("*")
        .order("id");

    if (error) {
        return (
            <main>
                <h1>Error loading movies</h1>
                <p>{error.message}</p>
            </main>
        );
    }

    return (
        <main
            style={{
                maxWidth: "700px",
                margin: "50px auto",
                fontFamily: "Arial",
            }}
        >
            <h1>My Favorite Movies</h1>

            <ul>
                {movies?.map((movie) => (
                    <li key={movie.id}>
                        {movie.title} — {movie.year}
                    </li>
                ))}
            </ul>
        </main>
    );
}