public class PersonalPlan extends AIModel {
    private int availableTokens;

    public PersonalPlan(String modelName, double price, int parameters, int contextWindow, int availableTokens) {
        super(modelName, price, parameters, contextWindow);
        this.availableTokens = availableTokens;
    }

    public int getAvailableTokens() {
        return availableTokens;
    }

    public String purchaseTokens(int tokens) {
        if (tokens < 0) {
            return "Error: Please enter a positive token value or upgrade to Pro Plan.";
        }

        availableTokens += tokens;
        return "Tokens added successfully. Available tokens: " + availableTokens;
    }

    public String enterPrompt(String promptText, int expectedOutputTokens) {
        try {
            int totalTokens = calculateTotalToken(promptText, expectedOutputTokens);

            if (totalTokens <= availableTokens) {
                availableTokens -= totalTokens;
                return "Prompt: " + promptText +
                       "\nExpected output tokens: " + expectedOutputTokens +
                       "\nTotal tokens used: " + totalTokens +
                       "\nRemaining tokens: " + availableTokens;
            } else {
                return "Not enough available tokens in Personal Plan.";
            }
        } catch (IllegalArgumentException e) {
            return "Error: " + e.getMessage();
        }
    }

    @Override
    public String display() {
        return "AI Model: " + getModelName() +
               "\nSubscription Cost: Rs. " + getCost() + " per 1 Lakh tokens" +
               "\nModel Size: " + getParameters() + " billion params" +
               "\nContext Window: " + getContextWindow() +
               "\nAvailable Tokens: " + availableTokens;
    }
}
