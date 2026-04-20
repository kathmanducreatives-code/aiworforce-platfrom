public abstract class AIModel {
    private String modelName;
    private double cost;
    private int parameters;
    private int contextWindow;

    public AIModel(String modelName, double cost, int parameters, int contextWindow) {
        this.modelName = modelName;
        this.cost = cost;
        this.parameters = parameters;
        this.contextWindow = contextWindow;
    }

    public String getModelName() {
        return modelName;
    }

    public double getCost() {
        return cost;
    }

    public int getParameters() {
        return parameters;
    }

    public int getContextWindow() {
        return contextWindow;
    }

    public int calculateTotalToken(String promptText, int expectedOutputTokens) {
        int inputTokens = 0;

        if (promptText != null && !promptText.trim().isEmpty()) {
            String[] words = promptText.trim().split("\\s+");
            inputTokens = words.length;
        }

        int totalTokens = inputTokens + expectedOutputTokens;

        if (totalTokens > contextWindow) {
            throw new IllegalArgumentException("Total tokens exceed context window.");
        }

        return totalTokens;
    }

    public abstract String display();
}
